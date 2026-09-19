// PDF do "Relatório de anúncios" (Automação 1 — relatorio_trafego_semanal).
//
// O relatório mais detalhado sobre mídia. Plano: docs/reporting/adaptive-report-plan.md §1.
//
//   A. abertura — manchete (o resultado mais justo) + faixa de números da mídia
//      [+ um alerta, só se elegível]
//   B. funil (sempre) ao lado das análises que explicam a semana
//   C. objetivos — verba × resultado e tabela comparativa (com 2+ objetivos)
//      campanhas — quando há mais campanhas do que objetivos
//   D. criativos — destaques com preview + tabela completa
//   E. tendência — pequenos múltiplos a partir de 3 semanas
//
// O tamanho segue o conteúdo: sem limite de linhas, a página flui. Toda leitura
// vem de adsInsights.ts; aqui só se decide onde cada coisa aparece.

import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import { campaignSummaries, previousPeriod, recomputeRatios, sumMetricsInto, type Period } from "@/app/admin/performance/insights";
import { CAMPAIGN_BLOCK_LABEL, type PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver } from "./campaignBlockKpis";
import {
  OUTCOME_WORDS, creativeBadges, creativeHighlights, creativeRows, deltaOf, dominantBlock, mediaAlert, mediaAnalysis,
  mediaFunnel, mediaOutcome, mediaTotals, money, num, objectiveRows, outcomeCost, outcomeValue, stageGap, weeklyTrend,
  type Badge, type CreativeRow, type MediaOutcome, type ObjectiveRow,
} from "./adsInsights";
import type { PreviewAsset } from "./creativePreviews";
import {
  AlertLine, AnalysisList, CreativeCards, DataTable, FigureRow, Footer, Headline, PageHeader, ProportionalFunnel, Section,
  ShareBars, SmallMultiples, T, W,
  type CreativeCardView, type FigureItem,
} from "./reportBlocks";

registerReportFonts();

export type AdsReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  // Linhas em nível de anúncio (conexão direta com a Meta). Vazio = sem criativos.
  adPosts: MetaPost[];
  /** Anúncios da semana anterior — destaques "explica a mudança" e "saturação". */
  prevAdPosts?: MetaPost[];
  /** Campanhas das últimas semanas (inclui a atual) — tendência. */
  trendPosts?: MetaPost[];
  /** Por adId: miniatura já embutível e link do post. */
  previews?: Record<string, PreviewAsset>;
  /** Instrução humana aplicada pela North Ai nesta revisão. */
  revisionInstruction?: string | null;
  generatedAt: Date;
};

export const fullDay = (iso: string) => iso.split("-").reverse().join("/");
export const shortDay = (iso: string) => iso.slice(5).split("-").reverse().join("/");
const pct = (v: number | null) => (v === null ? "—" : `${formatAcquisitionValue(v, "decimal")}%`);

export function creativeCardView(row: CreativeRow, badges: Badge[], outcome: MediaOutcome, previews?: Record<string, PreviewAsset>, hideClicks = false): CreativeCardView {
  const asset = previews?.[row.adId];
  const metrics = [
    row.result > 0 || outcome === "conversas" ? { label: row.resultUnit === "conversa" ? "conversas" : `${row.resultUnit}s`, value: num(row.result) } : null,
    !hideClicks && row.resultUnit !== "clique" ? { label: "cliques", value: num(row.clicks) } : null,
    { label: "investidos", value: money(row.spend) },
  ].filter((m): m is { label: string; value: string } => m !== null);
  return { name: row.name, badges, metrics, preview: asset?.dataUri ?? null, objectType: asset?.objectType ?? null, permalink: asset?.permalink ?? null };
}

/** Linhas da tabela comparativa por objetivo — compartilhada com o relatório 2. */
export function objectiveTable(objectives: ObjectiveRow[], outcome: MediaOutcome, hidden: { impressions?: boolean; clicks?: boolean } = {}) {
  const Wd = OUTCOME_WORDS[outcome];
  const best = objectives.filter((o) => o.costPerResult !== null).sort((a, b) => a.costPerResult! - b.costPerResult!)[0];
  return {
    columns: [
      { key: "obj", label: "Objetivo", flex: 1.5 },
      { key: "spend", label: "Investimento", align: "right" as const },
      { key: "reach", label: "Alcance", align: "right" as const },
      ...(!hidden.impressions ? [{ key: "impr", label: "Impressões", align: "right" as const }] : []),
      ...(!hidden.clicks ? [{ key: "clicks", label: "Cliques", align: "right" as const }] : []),
      ...(!hidden.impressions && !hidden.clicks ? [{ key: "ctr", label: "CTR", align: "right" as const, flex: 0.7 }] : []),
      { key: "visits", label: "Visitas", align: "right" as const },
      { key: "result", label: Wd.Plural, align: "right" as const },
      { key: "cost", label: `Custo por ${Wd.unit}`, align: "right" as const, flex: 1.1 },
    ],
    rows: objectives.map((o) => ({
      obj: { text: o.label, strong: true },
      spend: { text: money(o.spend), delta: null },
      reach: { text: num(o.reach) },
      impr: { text: num(o.impressions) },
      clicks: { text: num(o.clicks) },
      ctr: { text: pct(o.ctr) },
      visits: { text: num(o.visits) },
      result: { text: num(o.result), delta: o.resultDelta, strong: true },
      cost: { text: o.costPerResult === null ? "—" : money(o.costPerResult), delta: o.costDelta, strong: o === best },
    })),
    bestIndex: best ? objectives.indexOf(best) : -1,
    best,
  };
}

/** Structured view shared with the conversion report.  This is intentionally
 * independent from the raw Meta snapshot: a finalized traffic revision can
 * correct a number, hide a field, or remove trend charts without mutating raw
 * data. */
export type TrafficFinalView = {
  reach: number | null;
  hideClicks: boolean;
  hideImpressions: boolean;
  hideTrend?: boolean;
  instruction?: string | null;
};

export type RevisionAdjustments = TrafficFinalView;

/** Applies unambiguous editorial corrections without altering the raw Meta snapshot. */
export function revisionAdjustments(instruction?: string | null): RevisionAdjustments {
  const text = (instruction ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const hideClicks = /remov\w*[^.\n]{0,80}\bcliques?\b/.test(text);
  const hideImpressions = /remov\w*[^.\n]{0,80}\bimpressoes?\b/.test(text);
  const match = text.match(/alcance[^\d]{0,80}(\d[\d.,\s]*)/);
  const parsed = match ? Number(match[1].replace(/\D/g, "")) : NaN;
  return { hideClicks, hideImpressions, reach: Number.isFinite(parsed) && parsed >= 0 ? parsed : null };
}

export function trafficFinalViewOf(instruction?: string | null): TrafficFinalView {
  const base = revisionAdjustments(instruction);
  const text = (instruction ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return { ...base, hideTrend: /remov\w*[^.\n]{0,80}(grafic|tendenc)/.test(text), instruction: instruction ?? null };
}

type CampaignAgg = { id: string; name: string; objective: string; metrics: Partial<Record<MetaPostMetricKey, number>> };

function campaignsOf(posts: MetaPost[], blockOf: (id: string | undefined, name: string, objective?: string) => keyof typeof CAMPAIGN_BLOCK_LABEL): CampaignAgg[] {
  const byId = new Map<string, CampaignAgg>();
  for (const c of campaignSummaries(posts)) {
    const id = c.campaignId || c.caption;
    const agg = byId.get(id) ?? { id, name: c.caption, objective: CAMPAIGN_BLOCK_LABEL[blockOf(c.campaignId, c.caption, c.objective)], metrics: {} };
    sumMetricsInto(agg.metrics, c.metrics);
    byId.set(id, agg);
  }
  const out = [...byId.values()];
  out.forEach((c) => recomputeRatios(c.metrics));
  return out.sort((a, b) => (b.metrics.custo ?? 0) - (a.metrics.custo ?? 0));
}

function AdsReportDocument({ clientName, period, config, posts, prevPosts, adPosts, prevAdPosts, trendPosts, previews, revisionInstruction, generatedAt }: AdsReportInput) {
  const { blockOf, postBlock } = blockResolver(config);
  const cur = mediaTotals(posts);
  const revision = revisionAdjustments(revisionInstruction);
  if (revision.reach !== null) cur.reach = revision.reach;
  const prev = prevPosts.some((p) => p.source === "paid") ? mediaTotals(prevPosts) : null;
  const prevRange = previousPeriod(period);
  const comparedWith = prev ? `comparado com ${shortDay(prevRange.from)} a ${shortDay(prevRange.to)}` : "primeira semana registrada";

  const outcome = mediaOutcome(cur);
  const Wd = OUTCOME_WORDS[outcome];
  const objectives = objectiveRows(posts, prevPosts, postBlock, outcome);
  const dominant = dominantBlock(objectives);
  const { rows: creatives, hiddenNoise } = creativeRows(adPosts, outcome);
  const prevCreatives = prevAdPosts?.length ? creativeRows(prevAdPosts, outcome).rows : [];
  const rawBadges = creativeBadges(creatives, outcome, prevCreatives);
  // Quando a revisão remove métricas de tráfego, seus badges derivados não
  // podem reaparecer como "Mais cliques" ou "Melhor CTR" nos criativos.
  const badges = new Map([...rawBadges].flatMap(([id, values]) => {
    const visible = revision.hideClicks || revision.hideImpressions
      ? values.filter((badge) => !/cliqu|ctr|cpc|cpm|impress/i.test(`${badge.key} ${badge.label}`))
      : values;
    return visible.length ? [[id, visible] as [string, Badge[]]] : [];
  }));
  const highlights = creativeHighlights(creatives, badges, outcome, 4);
  const analysisInput = { cur, prev, outcome, objectives, creatives, badges };
  const analysis = mediaAnalysis(analysisInput);
  const alert = mediaAlert(analysisInput);
  const funnel = mediaFunnel(cur, outcome);
  const trend = weeklyTrend(trendPosts ?? [], period.to, outcome, 6);
  const campaigns = campaignsOf(posts, (id, name, objective) => blockOf(id, name, objective));

  const d = (c: number | null, p: number | null, dir: "higher_is_better" | "lower_is_better" | "neutral") => (prev ? deltaOf(c, p, dir) : null);
  const figures: FigureItem[] = [
    { label: "Investimento", value: money(cur.spend), delta: d(cur.spend, prev?.spend ?? null, "neutral") },
    { label: "Alcance", value: num(cur.reach), delta: d(cur.reach, prev?.reach ?? null, "higher_is_better") },
    ...(!revision.hideImpressions ? [{ label: "Impressões", value: num(cur.impressions), delta: d(cur.impressions, prev?.impressions ?? null, "higher_is_better") }] : []),
    ...(!revision.hideClicks ? [{ label: "Cliques", value: num(cur.clicks), delta: d(cur.clicks, prev?.clicks ?? null, "higher_is_better") }] : []),
    ...(!revision.hideImpressions && !revision.hideClicks && dominant === "trafego_site" && cur.ctr !== null ? [{ label: "CTR", value: pct(cur.ctr), delta: d(cur.ctr, prev?.ctr ?? null, "higher_is_better"), hint: "cliques por exibição" }] : []),
    { label: Wd.Plural, value: num(outcomeValue(cur, outcome)), delta: d(outcomeValue(cur, outcome), prev ? outcomeValue(prev, outcome) : null, "higher_is_better") },
    { label: `Custo por ${Wd.unit}`, value: money(outcomeCost(cur, outcome)), delta: d(outcomeCost(cur, outcome), prev ? outcomeCost(prev, outcome) : null, "lower_is_better") },
  ];

  const table = objectiveTable(objectives, outcome, { impressions: revision.hideImpressions, clicks: revision.hideClicks });
  // A nota técnica (CPE, CPC) só aparece quando o custo do RESULTADO do objetivo
  // também piorou. "Cada engajamento custou 305% mais" ao lado de "menor custo por
  // conversa" confundia: o cliente compra conversa, não engajamento.
  const technicalNotes = objectives.filter((o) => o.technical?.critical && o.costDelta.pct !== null && o.costDelta.pct >= 10).map((o) => `${o.label}: ${o.technical!.explanation.charAt(0).toLowerCase()}${o.technical!.explanation.slice(1)}`);
  const objectivesTitle = objectives.length >= 2 && table.best
    ? `${table.best.label} teve o menor custo por ${Wd.unit}`
    : "Objetivos";

  const leadCreative = highlights[0];
  const creativesTitle = leadCreative
    ? `${leadCreative.row.name} ${leadCreative.badges[0].key === "mais_conversas" ? "liderou as conversas" : leadCreative.badges[0].key === "mais_cliques" && !revision.hideClicks ? "liderou os cliques" : "se destacou na semana"}`
    : "Criativos";

  return (
    <Document>
      <Page size="A4" style={T.page} wrap>
        <PageHeader
          eyebrow={clientName}
          title="Relatório de anúncios"
          subtitle={`${fullDay(period.from)} a ${fullDay(period.to)} · ${comparedWith}`}
          pill="Relatório 1"
        />

        <Headline text={revision.hideClicks || revision.hideImpressions ? analysis.headline.replace(/[^.]*\b(cliques?|impressões|ctr|cpc|cpm)\b[^.]*\.?\s*/gi, "") : analysis.headline} />
        <FigureRow items={figures} />
        {alert ? <AlertLine text={alert} /> : null}

        <Section title={`Do alcance ${outcome === "conversas" ? "às conversas" : "às visitas ao perfil"}`}>
          <View style={T.twoCol} wrap={false}>
            <ProportionalFunnel
              width={analysis.insights.length ? 290 : 360}
              stages={funnel.map((s) => ({ label: s.label, value: num(s.value), numeric: s.value }))}
              gaps={funnel.slice(1).map((s, i) => stageGap(funnel[i], s))}
            />
            {analysis.insights.length ? (
              <View style={{ flex: 1, justifyContent: "center" }}>
                <AnalysisList items={analysis.insights} />
              </View>
            ) : null}
          </View>
        </Section>

        {objectives.length >= 2 ? (
          <Section title={objectivesTitle}>
            <ShareBars rows={objectives.map((o) => ({ label: o.label, spend: o.spendShare ?? 0, result: o.resultShare }))} resultLabel={`Parte das ${Wd.plural}`} />
            <View style={{ marginTop: 12 }}>
              <DataTable columns={table.columns} rows={table.rows} highlight={(i) => i === table.bestIndex} />
            </View>
            {technicalNotes.filter((n) => !(revision.hideClicks || revision.hideImpressions) || !/cliqu|impress|ctr|cpc|cpm/i.test(n)).map((n) => <Text key={n} style={T.note}>{n}</Text>)}
          </Section>
        ) : null}

        {campaigns.length > Math.max(1, objectives.length) ? (
          <Section title="Campanhas" aside={`${campaigns.length} campanhas com investimento`}>
            <DataTable
              columns={[
                { key: "name", label: "Campanha", flex: 2.4 },
                { key: "obj", label: "Objetivo", flex: 1.3 },
                { key: "spend", label: "Investimento", align: "right" },
                ...(!revision.hideImpressions ? [{ key: "impr", label: "Impressões", align: "right" as const }] : []),
                ...(!revision.hideClicks ? [{ key: "clicks", label: "Cliques", align: "right" as const }] : []),
                { key: "result", label: Wd.Plural, align: "right" },
                { key: "cost", label: `Custo por ${Wd.unit}`, align: "right", flex: 1.1 },
              ]}
              rows={campaigns.map((c) => {
                const result = outcome === "conversas" ? c.metrics.contatos ?? 0 : c.metrics.profileVisits ?? 0;
                return {
                  name: { text: c.name, strong: true },
                  obj: { text: c.objective },
                  spend: { text: money(c.metrics.custo ?? 0) },
                  impr: { text: num(c.metrics.impressoes ?? null) },
                  clicks: { text: num(c.metrics.cliques ?? c.metrics.cliquesLink ?? null) },
                  result: { text: num(result) },
                  cost: { text: result > 0 && c.metrics.custo ? money(c.metrics.custo / result) : "—" },
                };
              })}
            />
          </Section>
        ) : null}

        {creatives.length ? (
          <Section
            title={creativesTitle}
            aside={hiddenNoise > 0 ? `mais ${hiddenNoise} com investimento abaixo de R$ 2` : undefined}
            lead={<CreativeCards items={highlights.map((h) => creativeCardView(h.row, h.badges, outcome, previews, revision.hideClicks))} />}
          >
            {creatives.length > 1 ? (
              <View style={{ marginTop: 12 }}>
                <DataTable
                  columns={[
                    { key: "thumb", label: "", width: 26 },
                    { key: "name", label: "Criativo", flex: 2.1 },
                    { key: "spend", label: "Investimento", align: "right", flex: 1.25 },
                    ...(!revision.hideImpressions ? [{ key: "impr", label: "Impressões", align: "right" as const }] : []),
                    ...(!revision.hideClicks ? [{ key: "clicks", label: "Cliques", align: "right" as const }] : []),
                    ...(!revision.hideImpressions && !revision.hideClicks ? [{ key: "ctr", label: "CTR", align: "right" as const, flex: 0.7 }] : []),
                    { key: "result", label: Wd.Plural, align: "right" },
                    { key: "cost", label: `Custo por ${Wd.unit}`, align: "right", flex: 1.1 },
                    { key: "badge", label: "Destaque", flex: 1.6 },
                  ]}
                  rows={creatives.map((r) => {
                    const b = badges.get(r.adId) ?? [];
                    return {
                      thumb: { text: "", image: previews?.[r.adId]?.dataUri ?? null },
                      name: { text: r.name, strong: b.length > 0 },
                      spend: { text: money(r.spend) },
                      impr: { text: num(r.impressions) },
                      clicks: { text: num(r.clicks) },
                      ctr: { text: pct(r.ctr) },
                      result: { text: num(outcome === "conversas" ? r.conversations : r.visits ?? null) },
                      cost: { text: r.costPerResult === null ? "—" : money(r.costPerResult) },
                      badge: { text: b.map((x) => x.label).join(" · "), tone: b[0]?.tone },
                    };
                  })}
                  highlight={(i) => badges.has(creatives[i].adId)}
                />
              </View>
            ) : null}
          </Section>
        ) : null}

        {trend.length >= 3 ? (
          <Section title={`Últimas ${trend.length} semanas`}>
            <SmallMultiples
              charts={[
                { title: "Investimento", periods: trend.map((t) => shortDay(t.weekTo)), values: trend.map((t) => t.spend), format: (v) => money(v) },
                { title: Wd.Plural, periods: trend.map((t) => shortDay(t.weekTo)), values: trend.map((t) => t.result), format: (v) => num(v) },
                { title: `Custo por ${Wd.unit}`, periods: trend.map((t) => shortDay(t.weekTo)), values: trend.map((t) => t.cost), format: (v) => money(v) },
              ]}
            />
          </Section>
        ) : null}

        {revisionInstruction ? (
          <Section title="Revisão solicitada">
            <Text style={T.note}>{revisionInstruction}</Text>
          </Section>
        ) : null}

        <Footer
          left={`North · ${clientName} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`}
          note={campaigns.length >= 2 ? "Alcance somado entre campanhas pode contar a mesma pessoa mais de uma vez." : null}
        />
      </Page>
    </Document>
  );
}

export async function renderAdsReportPdf(input: AdsReportInput): Promise<Buffer> {
  return renderToBuffer(<AdsReportDocument {...input} />);
}
