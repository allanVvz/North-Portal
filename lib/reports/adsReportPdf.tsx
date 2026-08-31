// PDF do "Relatório de anúncios" (Automação 1 — relatorio_trafego_semanal).
//
// Formato-alvo: o resumo que a equipe manda hoje à mão — KPIs agrupados por
// TIPO DE CAMPANHA (tráfego site / tráfego perfil / mensagens / engajamento),
// a lista de CRIATIVOS abaixo de cada campanha, e o FUNIL por último,
// agregando tudo. Sem gráfico de linha diário.
//
// O bloco de cada campanha vem de `config.campaignBlocks` (tag manual no
// template; suggestCampaignBlock só como fallback). A fonte #1/#2/#3 de cada
// criativo vem de `config.adSourceTags`. As etapas do funil vêm de
// `config.acquisition.funnelStages`; uma etapa de cauda sem dado sai do funil
// (funnelStageCount).
//
// Renderiza server-side com @react-pdf/renderer (sem browser, sem rede) — Node
// runtime obrigatório (app/api/admin/automations/run/route.ts). Cores em
// reportTheme.ts, fontes em reportFonts.ts, componentes em reportComponents.tsx.

import { Document, Page, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  acquisitionMetricLabel, formatAcquisitionValue, ratio, resolveAcquisitionMetric,
  totalWhenPresent, type NullableMetric,
} from "@/app/admin/performance/acquisitionInsights";
import {
  campaignSummaries, isNotIntegrated, metricLabel, recomputeRatios, sumMetricsInto,
  type Period,
} from "@/app/admin/performance/insights";
import { metricRefInverse, metricRefKind, metricValue } from "@/app/admin/performance/performanceLabels";
import {
  CAMPAIGN_BLOCKS, CAMPAIGN_BLOCK_LABEL, suggestCampaignBlock,
  type CampaignBlock, type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
import type { MetricRef } from "@/lib/performancePrefs";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";
import { funnelStageCount } from "./funnelGeometry";
import { registerReportFonts } from "./reportFonts";
import { COMPASS_VIEWBOX, REPORT_COLORS as C, compassShapes } from "./reportTheme";
import {
  CompassNode, DeltaText, FunnelSvg, KpiCard, REPORT_STYLES as S,
  ResultPanel, gaugeKind,
} from "./reportComponents";

registerReportFonts();

export type AdsReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  // Linhas em nível de anúncio (só na conexão direta com a Meta) — a tabela de
  // criativos por campanha sai daqui. Vazio = conta sem detalhe por criativo.
  adPosts: MetaPost[];
  generatedAt: Date;
};

// ---- KPIs por bloco ----------------------------------------------------

type BlockKpi = { label: string; metric?: MetricRef; ratio?: [MetricRef, MetricRef] };

// "Mensagens" (metric `contatos`) entra em TODO bloco: "alguém chamou" é o
// desfecho que a equipe conta, independente do objetivo da campanha. "Visitas ao
// perfil" (`profileVisits`, ingerido de instagram_profile_visits) entra onde faz
// sentido. "Novos seguidores" fica zerado — a Meta não expõe follows na API.
const BLOCK_KPIS: Record<CampaignBlock, BlockKpi[]> = {
  trafego_site: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Cliques no site", metric: "cliquesLink" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por clique", ratio: ["custo", "cliquesLink"] },
  ],
  trafego_perfil: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Novos seguidores", metric: "followersGained" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por visita", ratio: ["custo", "profileVisits"] },
  ],
  mensagens: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por mensagem", ratio: ["custo", "contatos"] },
  ],
  engajamento: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Engajamento", metric: "engajamento" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por engajamento", ratio: ["custo", "engajamento"] },
  ],
  outro: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Cliques", metric: "cliques" },
    { label: "Mensagens", metric: "contatos" },
    { label: "CTR", metric: "ctr" },
  ],
};

// Métricas que o relatório força a "0" em vez de "—"/"Sem integração": são
// contagens onde zero é informação real numa conta Meta paga. `contatos`
// unificado (msg/lead/conversa) e `followersGained` (a Meta não entrega follows;
// o usuário quer a etapa visível zerada).
const ZERO_NOT_DASH = new Set<MetricRef>(["contatos", "followersGained"]);

// ---- componentes locais ----------------------------------------------

function GaugeCard({
  label, current, previous, kind, inverse,
}: {
  label: string; current: NullableMetric; previous: NullableMetric;
  kind: "money" | "percent" | "decimal"; inverse: boolean;
}) {
  const max = Math.max(current ?? 0, previous ?? 0);
  const progress = current === null || max === 0 ? 0 : Math.max(7, (current / max) * 100);
  const cx = 48;
  const cy = 44;
  const R = 34;
  const theta = ((180 - (progress / 100) * 180) * Math.PI) / 180;
  const px = cx + R * Math.cos(theta);
  const py = cy - R * Math.sin(theta);
  return (
    <View style={S.gaugeCard} wrap={false}>
      <Svg viewBox="0 0 96 52" style={{ width: 78, height: 42 }}>
        <Path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke={C.inset} strokeWidth={8} />
        {progress > 0 ? (
          <Path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${px} ${py}`} fill="none" stroke={C.tealStrong} strokeWidth={8} strokeLinecap="round" />
        ) : null}
      </Svg>
      <Text style={S.gaugeLabel}>{label.toUpperCase()}</Text>
      <Text style={S.gaugeValue}>{formatAcquisitionValue(current, kind)}</Text>
      <DeltaText current={current} previous={previous} inverse={inverse} />
    </View>
  );
}

// Linhas de criativo de UMA campanha, agregadas por adId (soma entre
// plataformas), ratios re-derivadas do total. Puro.
type CreativeRow = { adId: string; name: string; metrics: Partial<Record<MetaPostMetricKey, number>>; currency?: string };
function creativeRowsFor(adPosts: MetaPost[], campaignId: string): CreativeRow[] {
  const byId = new Map<string, CreativeRow>();
  for (const p of adPosts) {
    if (!p.adId || p.campaignId !== campaignId) continue;
    let row = byId.get(p.adId);
    if (!row) {
      row = { adId: p.adId, name: p.adName || p.caption || p.adId, metrics: {}, currency: p.currency };
      byId.set(p.adId, row);
    }
    sumMetricsInto(row.metrics, p.metrics);
  }
  const rows = [...byId.values()];
  for (const row of rows) recomputeRatios(row.metrics);
  return rows.sort((a, b) => (b.metrics.custo ?? 0) - (a.metrics.custo ?? 0));
}

const CREATIVE_COLS: { key: MetaPostMetricKey; label: string; kind: "number" | "money" | "percent" }[] = [
  { key: "alcance", label: "Alcance", kind: "number" },
  { key: "impressoes", label: "Impr.", kind: "number" },
  { key: "cliquesLink", label: "Cliques", kind: "number" },
  { key: "contatos", label: "Mensagens", kind: "number" },
  { key: "custo", label: "Invest.", kind: "money" },
  { key: "ctr", label: "CTR", kind: "percent" },
];

// ---- documento ------------------------------------------------------

function AdsReportDocument({ clientName, period, cadenceLabel, config, posts, prevPosts, adPosts, generatedAt }: AdsReportInput) {
  const acq = config.acquisition;
  const cm = config.prefs.customMetrics;
  const hidden = new Set(acq.hiddenSections);

  const blockOf = (campaignId: string | undefined, campaignName: string | undefined, objective?: string, optimizationGoal?: string): CampaignBlock =>
    config.campaignBlocks[campaignId ?? campaignName ?? ""] ?? suggestCampaignBlock(objective, optimizationGoal, campaignName);
  const postBlock = (p: MetaPost) => blockOf(p.campaignId, p.campaignName ?? p.caption, p.objective, p.optimizationGoal);

  // Blocos presentes, na ordem canônica.
  const blocksPresent = CAMPAIGN_BLOCKS.filter((block) => posts.some((p) => postBlock(p) === block));

  const kpiForDef = (def: BlockKpi, cur: MetaPost[], prev: MetaPost[]) => {
    if (def.ratio) {
      const [num, den] = def.ratio;
      return {
        label: def.label,
        value: ratio(resolveAcquisitionMetric(cur, num, cm), resolveAcquisitionMetric(cur, den, cm)),
        previous: ratio(resolveAcquisitionMetric(prev, num, cm), resolveAcquisitionMetric(prev, den, cm)),
        kind: "money" as const,
        inverse: true,
        notIntegrated: false,
      };
    }
    const ref = def.metric as MetricRef;
    const zero = ZERO_NOT_DASH.has(ref);
    return {
      label: def.label,
      value: resolveAcquisitionMetric(cur, ref, cm) ?? (zero ? 0 : null),
      previous: resolveAcquisitionMetric(prev, ref, cm) ?? (zero ? 0 : null),
      kind: metricRefKind(ref, cm),
      inverse: metricRefInverse(ref, cm),
      notIntegrated: zero ? false : isNotIntegrated(ref, cm),
    };
  };

  // O relatório é por CAMPANHA, não por campanha×plataforma — campaignSummaries
  // devolve uma linha por plataforma, então agregamos por campaignId aqui.
  const byCampaign = new Map<string, { id: string; campaignId?: string; caption: string; objective?: string; metrics: Partial<Record<MetaPostMetricKey, number>>; currency?: string }>();
  for (const c of campaignSummaries(posts)) {
    const id = c.campaignId || c.caption;
    let agg = byCampaign.get(id);
    if (!agg) {
      agg = { id, campaignId: c.campaignId, caption: c.caption, objective: c.objective, metrics: {}, currency: c.currency };
      byCampaign.set(id, agg);
    }
    sumMetricsInto(agg.metrics, c.metrics);
  }
  const allCampaigns = [...byCampaign.values()]
    .map((c) => {
      recomputeRatios(c.metrics);
      return { ...c, block: blockOf(c.campaignId, c.caption, c.objective) };
    })
    .sort((a, b) => (b.metrics.custo ?? b.metrics.alcance ?? 0) - (a.metrics.custo ?? a.metrics.alcance ?? 0));
  // Uma folha só: no máximo 6 campanhas e 3 criativos por campanha.
  const CAMPAIGN_CAP = 6;
  const CREATIVE_CAP = 3;
  const campaigns = allCampaigns.slice(0, CAMPAIGN_CAP);
  const campaignsOverflow = allCampaigns.length - campaigns.length;

  // Funil agregado — etapa de cauda sem dado sai (funnelStageCount). `contatos`
  // e `followersGained` viram 0 (não faixa tracejada): são contagens que o
  // relatório mostra zeradas de propósito.
  const allFunnelValues = acq.funnelStages.map(
    (r) => resolveAcquisitionMetric(posts, r, cm) ?? (ZERO_NOT_DASH.has(r) ? 0 : null),
  );
  const keepN = funnelStageCount(allFunnelValues);
  const funnelValues = allFunnelValues.slice(0, keepN);
  const funnelLabels = acq.funnelStages.slice(0, keepN).map((r) => acquisitionMetricLabel(r, cm, metricLabel));
  const spend = totalWhenPresent(posts, "custo");

  const subtitle = `${cadenceLabel} · ${period.from} a ${period.to} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`;

  return (
    <Document>
      <Page size="A4" style={S.page} wrap>
        <View style={S.header}>
          <Svg viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`} style={{ width: 20, height: 20 }}>
            {compassShapes.map((shape, i) => <CompassNode key={i} shape={shape} ink={C.tealStrong} />)}
          </Svg>
          <View>
            <Text style={S.title}>Relatório de anúncios — {clientName}</Text>
            <Text style={S.subtitle}>{subtitle}</Text>
          </View>
        </View>

        {/* KPIs por bloco de objetivo */}
        {!hidden.has("kpis") && blocksPresent.length ? (
          <View style={S.section}>
            <Text style={S.kicker}>Resultados por campanha</Text>
            {blocksPresent.map((block) => {
              const cur = posts.filter((p) => postBlock(p) === block);
              const prev = prevPosts.filter((p) => postBlock(p) === block);
              return (
                <View style={S.blockGroup} key={block} wrap={false}>
                  <View style={S.blockHead}>
                    <Text style={S.blockTitle}>{CAMPAIGN_BLOCK_LABEL[block]}</Text>
                  </View>
                  <View style={S.grid}>
                    {BLOCK_KPIS[block].map((def) => <KpiCard key={def.label} {...kpiForDef(def, cur, prev)} />)}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Criativos por campanha */}
        <View style={S.section}>
          <Text style={S.kicker}>Criativos</Text>
          {campaigns.length ? campaigns.map((c) => {
            const all = c.campaignId ? creativeRowsFor(adPosts, c.campaignId) : [];
            const rows = all.slice(0, CREATIVE_CAP);
            const rowsOverflow = all.length - rows.length;
            return (
              <View key={c.id} wrap={false}>
                <View style={S.campaignHead}>
                  <Text style={S.campaignName}>{c.caption || "Sem nome"}</Text>
                  <Text style={S.chip}>{CAMPAIGN_BLOCK_LABEL[c.block]}</Text>
                </View>
                {rows.length ? (
                  <>
                    <View style={S.table}>
                      <View style={S.tableRow}>
                        <Text style={[S.tableHeaderCell, { flex: 0.5 }]}>#</Text>
                        <Text style={[S.tableHeaderCell, S.tableCellFirst]}>Criativo</Text>
                        {CREATIVE_COLS.map((col) => <Text style={S.tableHeaderCell} key={col.key}>{col.label}</Text>)}
                      </View>
                      {rows.map((row, i) => (
                        <View style={i === rows.length - 1 ? S.tableRowLast : S.tableRow} key={row.adId} wrap={false}>
                          <Text style={[S.tableCell, { flex: 0.5 }]}>{config.adSourceTags[row.adId] ? `#${config.adSourceTags[row.adId]}` : "—"}</Text>
                          <Text style={[S.tableCell, S.tableCellFirst]}>{row.name}</Text>
                          {CREATIVE_COLS.map((col) => {
                            const raw = row.metrics[col.key] ?? (ZERO_NOT_DASH.has(col.key) ? 0 : undefined);
                            return (
                              <Text style={S.tableCell} key={col.key}>
                                {raw === undefined ? "—" : metricValue(raw, col.kind, row.currency)}
                              </Text>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                    {rowsOverflow > 0 ? <Text style={S.tableMore}>+{rowsOverflow} criativo{rowsOverflow > 1 ? "s" : ""} com menos investimento.</Text> : null}
                  </>
                ) : (
                  <Text style={S.empty}>Sem detalhe por criativo nesta conta.</Text>
                )}
              </View>
            );
          }) : <Text style={S.empty}>Nenhuma campanha com dados no período.</Text>}
          {campaignsOverflow > 0 ? <Text style={S.tableMore}>+{campaignsOverflow} campanha{campaignsOverflow > 1 ? "s" : ""} com menos investimento no período.</Text> : null}
        </View>

        {/* Eficiência de mídia (opcional, controlado pelo template) */}
        {!hidden.has("gauges") && acq.gaugeSlots.length ? (
          <View style={S.section} wrap={false}>
            <Text style={S.kicker}>Eficiência de mídia</Text>
            <View style={S.grid}>
              {acq.gaugeSlots.map((ref) => (
                <GaugeCard
                  key={ref}
                  label={acquisitionMetricLabel(ref, cm, metricLabel)}
                  current={resolveAcquisitionMetric(posts, ref, cm)}
                  previous={resolveAcquisitionMetric(prevPosts, ref, cm)}
                  kind={gaugeKind(metricRefKind(ref, cm))}
                  inverse={metricRefInverse(ref, cm)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Funil agregado — por último */}
        {!hidden.has("funnel") && funnelValues.length >= 2 ? (
          <View style={S.section} wrap={false}>
            <Text style={S.kicker}>Visão geral</Text>
            <Text style={S.sectionTitle}>Funil de aquisição</Text>
            <View style={S.funnelRow}>
              <FunnelSvg labels={funnelLabels} values={funnelValues} />
              <ResultPanel
                label={funnelLabels.at(-1) ?? "Resultado"}
                value={funnelValues.at(-1) ?? null}
                previousStage={funnelValues.at(-2) ?? null}
                previousLabel={funnelLabels.at(-2) ?? ""}
                spend={spend}
              />
            </View>
          </View>
        ) : null}

        <Text style={S.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>
    </Document>
  );
}

export async function renderAdsReportPdf(input: AdsReportInput): Promise<Buffer> {
  return renderToBuffer(<AdsReportDocument {...input} />);
}
