// PDF do "Relatório de vendas" (Automação 2 — relatorio_vendas).
//
// Fecha o fluxo de conversão: cruza os números do Meta (tráfego, conversas) com
// as conversões que o responsável lançou no comentário do card manual (via
// lib/ai/extractMetrics). Uma folha A4.
//
// Estrutura: (1) resumo do período, (2) resultados por objetivo — os KPIs Meta
// por bloco (CampaignBlocksSection), mais Vendas/Receita/ROAS atribuídos ao
// bloco via a fonte #1/#2/#3 do criativo taggeado, (3) fonte de tráfego ×
// objetivo — a mesma atribuição vista por fonte, (4) vendas e agendamentos
// detalhados, (5) funil de vendas. Sem tag de fonte no template, a conversão
// por objetivo não é rastreável e a seção (2) mostra só a mídia + uma nota.
//
// Reusa reportComponents.tsx / reportTheme.ts / reportFonts.ts / funnelGeometry.ts
// — mesmos KPIs, mesmo funil e mesmo painel de resultado do relatório de anúncios.

import { Document, Page, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  formatAcquisitionValue, ratio, resolveAcquisitionMetric,
  totalWhenPresent, type NullableMetric,
} from "@/app/admin/performance/acquisitionInsights";
import type { Period } from "@/app/admin/performance/insights";
import { metricValue } from "@/app/admin/performance/performanceLabels";
import { CAMPAIGN_BLOCK_LABEL, type CampaignBlock, type PerformanceTemplateConfig, type AdSourceTag } from "@/lib/performanceTemplates";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { MetaPost } from "@/lib/windsor";
import { funnelStageCount } from "./funnelGeometry";
import { registerReportFonts } from "./reportFonts";
import { COMPASS_VIEWBOX, REPORT_COLORS as C, compassShapes } from "./reportTheme";
import { CompassNode, FunnelSvg, KpiCard, REPORT_STYLES as S, ResultPanel } from "./reportComponents";
import { CampaignBlocksSection, blockResolver } from "./campaignBlockKpis";

registerReportFonts();

export type SalesReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  campaignPosts: MetaPost[];
  adPosts: MetaPost[];
  prevCampaignPosts: MetaPost[];
  conversoes: ConversionRow[];
  prevConversoes?: ConversionRow[];
  /** Totais relatados no comentário (o gestor diz "5 vendas, 9 orçamentos" sem
   *  detalhar linha a linha). Quando ausentes, caem na contagem das linhas de
   *  `conversoes`; as linhas ficam só para a tabela de detalhe e o rateio por
   *  fonte. */
  receitaTotal?: number | null;
  vendasTotal?: number | null;
  agendamentosTotal?: number | null;
  /** Seguidores ganhos no período (relatado no comentário). */
  seguidores?: number | null;
  generatedAt: Date;
};

type SalesTotals = { agendamentos: number; vendas: number; receita: number };
function totalsOf(conversoes: ConversionRow[]): SalesTotals {
  return {
    agendamentos: conversoes.length,
    vendas: conversoes.filter((c) => c.status === "fechado").length,
    receita: conversoes.reduce((sum, c) => sum + (c.valor ?? 0), 0),
  };
}

const SOURCE_ROWS: (AdSourceTag | null)[] = ["1", "2", "3", null];
const SOURCE_LABEL = (tag: AdSourceTag | null) => (tag ? `Fonte #${tag}` : "Sem tag");

function SalesReportDocument({
  clientName, period, cadenceLabel, config, campaignPosts, adPosts, prevCampaignPosts, conversoes, prevConversoes, receitaTotal, vendasTotal, agendamentosTotal, seguidores, generatedAt,
}: SalesReportInput) {
  const cm = config.prefs.customMetrics;
  const linhasTotals = totalsOf(conversoes);
  // O total exibido é o relatado no comentário quando existe; senão, a contagem
  // / soma das linhas detalhadas. Agendamentos nunca fica abaixo de vendas — uma
  // venda fechada passou por um agendamento, e o funil não pode alargar.
  const vendas = vendasTotal ?? linhasTotals.vendas;
  const cur = {
    vendas,
    agendamentos: Math.max(agendamentosTotal ?? linhasTotals.agendamentos, vendas),
    receita: receitaTotal ?? linhasTotals.receita,
  };
  const prev = prevConversoes ? totalsOf(prevConversoes) : null;
  const spend = totalWhenPresent(campaignPosts, "custo") ?? 0;
  const prevSpend = totalWhenPresent(prevCampaignPosts, "custo") ?? 0;

  const kpi = (label: string, value: NullableMetric, previous: NullableMetric, kind: "money" | "number" | "percent" | "decimal", inverse = false) =>
    ({ label, value, previous, kind, inverse, notIntegrated: false });

  const summaryKpis = [
    kpi("Investimento", spend, prevSpend || null, "money"),
    kpi("Receita da semana", cur.receita || null, prev ? prev.receita || null : null, "money"),
    kpi("Agendamentos", cur.agendamentos, prev ? prev.agendamentos : null, "number"),
    kpi("Vendas fechadas", cur.vendas, prev ? prev.vendas : null, "number"),
    kpi("Ticket médio", ratio(cur.receita, cur.vendas), prev ? ratio(prev.receita, prev.vendas) : null, "money"),
    kpi("ROI (ROAS)", ratio(cur.receita, spend), prev ? ratio(prev.receita, prevSpend) : null, "decimal"),
    ...(seguidores != null && seguidores > 0 ? [kpi("Seguidores ganhos", seguidores, null, "number")] : []),
  ];

  // Uma tabela só: cada FONTE #1/#2/#3 é uma linha, com o OBJETIVO da(s)
  // campanha(s) taggeada(s) como coluna — cruza receita (do comentário) com
  // custo/conversas (do anúncio taggeado) sem repetir os números por objetivo
  // numa seção à parte. Só entra a linha que tem algum dado.
  const { postBlock } = blockResolver(config);
  const sourceRows = SOURCE_ROWS.map((tag) => {
    const conv = conversoes.filter((c) => (c.fonte ?? null) === tag);
    const ads = adPosts.filter((p) => (config.adSourceTags[p.adId ?? ""] ?? null) === tag);
    const t = totalsOf(conv);
    const custo = totalWhenPresent(ads, "custo") ?? 0;
    const blocks = [...new Set(ads.map(postBlock))];
    const objetivo = blocks.length === 0 ? "—" : blocks.length === 1 ? CAMPAIGN_BLOCK_LABEL[blocks[0]] : "Vários";
    return {
      tag,
      objetivo,
      custo,
      conversas: totalWhenPresent(ads, "contatos"),
      agendamentos: t.agendamentos,
      vendas: t.vendas,
      receita: t.receita,
      roas: ratio(t.receita, custo),
      hasData: conv.length > 0 || ads.length > 0,
    };
  }).filter((r) => r.hasData);

  // Conversão atribuída a cada OBJETIVO: cada venda/agendamento com fonte
  // #1/#2/#3 cai no bloco do anúncio taggeado com essa fonte. Criativo sem tag →
  // fica de fora (a nota abaixo da seção avisa como ligar). O relatório de
  // anúncios não recebe isto.
  const blockOfFonte = (fonte: ConversionRow["fonte"]): CampaignBlock | null => {
    if (!fonte) return null;
    const ad = adPosts.find((p) => (config.adSourceTags[p.adId ?? ""] ?? null) === fonte);
    return ad ? postBlock(ad) : null;
  };
  const convByBlock = new Map<CampaignBlock, ConversionRow[]>();
  for (const c of conversoes) {
    const b = blockOfFonte(c.fonte);
    if (b) convByBlock.set(b, [...(convByBlock.get(b) ?? []), c]);
  }
  const receitaAtribuida = [...convByBlock.values()].flat().reduce((s, c) => s + (c.valor ?? 0), 0);
  const receitaSemObjetivo = cur.receita > 0 && receitaAtribuida <= 0;

  const objetivoExtraKpis = (block: CampaignBlock, blockPosts: MetaPost[]) => {
    const conv = convByBlock.get(block) ?? [];
    if (!conv.length) return [];
    const t = totalsOf(conv);
    const custoBloco = totalWhenPresent(blockPosts, "custo") ?? 0;
    return [
      kpi("Agendamentos", t.agendamentos, null, "number"),
      kpi("Vendas", t.vendas, null, "number"),
      kpi("Receita", t.receita || null, null, "money"),
      kpi("ROAS", ratio(t.receita, custoBloco), null, "decimal"),
    ];
  };

  // Detalhe linha a linha do que o gestor descreveu (serviço/valor/fonte/status).
  // Uma folha só: no máximo 12 linhas, priorizando as de maior valor.
  const DETALHE_CAP = 12;
  const conversoesOrdenadas = [...conversoes].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
  const detalhe = conversoesOrdenadas.slice(0, DETALHE_CAP);
  const conversoesOverflow = conversoesOrdenadas.length - detalhe.length;
  // Quantas das vendas/agendamentos relatados foram descritos linha a linha — o
  // gestor pode dizer "5 vendas" e detalhar só 2. Nota só quando difere.
  const descritas = conversoesOrdenadas.length;
  const relatadas = Math.max(cur.vendas, cur.agendamentos);
  const parcialmenteDetalhado = detalhe.length > 0 && descritas < relatadas;

  // Funil agregado — cauda sem dado sai (funnelStageCount). "Seguidores ganhos"
  // (relatado no comentário, não vem da Meta) entra como etapa só quando houve
  // ganho no período; zero não vira degrau vazio.
  const funnelRaw: { label: string; value: NullableMetric }[] = [
    { label: "Alcance", value: resolveAcquisitionMetric(campaignPosts, "alcance", cm) },
    { label: "Cliques", value: resolveAcquisitionMetric(campaignPosts, "cliquesLink", cm) },
    ...(seguidores != null && seguidores > 0 ? [{ label: "Seguidores", value: seguidores as NullableMetric }] : []),
    { label: "Conversas", value: resolveAcquisitionMetric(campaignPosts, "contatos", cm) ?? 0 },
    { label: "Agendamentos", value: cur.agendamentos },
    { label: "Vendas", value: cur.vendas },
  ];
  // Etapa sem dado nenhum (`null`) sai do funil em qualquer posição — não vira
  // faixa tracejada vazia. Cauda `0` ainda é aparada pelo funnelStageCount.
  const funnelStages = funnelRaw.filter((s) => s.value !== null);
  const values = funnelStages.map((s) => s.value);
  const keepN = funnelStageCount(values);
  const funnelLabels = funnelStages.slice(0, keepN).map((s) => s.label);
  const funnelValues = values.slice(0, keepN);

  const subtitle = `${cadenceLabel} · ${period.from} a ${period.to} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`;
  const fmtMoney = (v: NullableMetric) => formatAcquisitionValue(v, "money");

  return (
    <Document>
      <Page size="A4" style={S.page} wrap>
        <View style={S.header}>
          <Svg viewBox={`0 0 ${COMPASS_VIEWBOX} ${COMPASS_VIEWBOX}`} style={{ width: 20, height: 20 }}>
            {compassShapes.map((shape, i) => <CompassNode key={i} shape={shape} ink={C.tealStrong} />)}
          </Svg>
          <View>
            <Text style={S.title}>Relatório de vendas — {clientName}</Text>
            <Text style={S.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.kicker}>Resumo do período</Text>
          <View style={S.grid}>
            {summaryKpis.map((k) => <KpiCard key={k.label} {...k} />)}
          </View>
        </View>

        <CampaignBlocksSection
          config={config}
          posts={campaignPosts}
          prevPosts={prevCampaignPosts}
          kicker="Resultados por objetivo"
          extraKpis={objetivoExtraKpis}
          footer={receitaSemObjetivo
            ? "Receita não rastreada por objetivo — marque os criativos com fonte #1/#2/#3 no template do relatório para ver vendas e ROAS por bloco."
            : undefined}
        />

        <View style={S.section}>
          <Text style={S.kicker}>Fonte de tráfego e objetivo</Text>
          {sourceRows.length ? (
            <View style={S.table}>
              <View style={S.tableRow}>
                <Text style={[S.tableHeaderCell, { flex: 1.3 }]}>Fonte</Text>
                <Text style={[S.tableHeaderCell, { flex: 1.8 }]}>Objetivo</Text>
                <Text style={S.tableHeaderCell}>Invest.</Text>
                <Text style={S.tableHeaderCell}>Conversas</Text>
                <Text style={S.tableHeaderCell}>Agend.</Text>
                <Text style={S.tableHeaderCell}>Vendas</Text>
                <Text style={S.tableHeaderCell}>Receita</Text>
                <Text style={S.tableHeaderCell}>ROAS</Text>
              </View>
              {sourceRows.map((r, i) => (
                <View style={i === sourceRows.length - 1 ? S.tableRowLast : S.tableRow} key={r.tag ?? "none"} wrap={false}>
                  <Text style={[S.tableCell, { flex: 1.3 }]}>{SOURCE_LABEL(r.tag)}</Text>
                  <Text style={[S.tableCell, { flex: 1.8 }]}>{r.objetivo}</Text>
                  <Text style={S.tableCell}>{fmtMoney(r.custo || null)}</Text>
                  <Text style={S.tableCell}>{formatAcquisitionValue(r.conversas)}</Text>
                  <Text style={S.tableCell}>{r.agendamentos}</Text>
                  <Text style={S.tableCell}>{r.vendas}</Text>
                  <Text style={S.tableCell}>{fmtMoney(r.receita || null)}</Text>
                  <Text style={S.tableCell}>{r.roas === null ? "—" : metricValue(r.roas, "decimal")}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={S.empty}>Nenhuma conversão com fonte identificada no período.</Text>
          )}
        </View>

        {detalhe.length ? (
          <View style={S.section}>
            <Text style={S.kicker}>Vendas e agendamentos detalhados</Text>
            {parcialmenteDetalhado ? (
              <Text style={S.empty}>{descritas} de {relatadas} descrito{descritas > 1 ? "s" : ""} no comentário; o resumo acima usa os totais relatados.</Text>
            ) : null}
            <View style={S.table}>
              <View style={S.tableRow}>
                <Text style={[S.tableHeaderCell, S.tableCellFirst]}>Serviço</Text>
                <Text style={S.tableHeaderCell}>Fonte</Text>
                <Text style={S.tableHeaderCell}>Situação</Text>
                <Text style={S.tableHeaderCell}>Valor</Text>
              </View>
              {detalhe.map((row, i) => (
                <View style={i === detalhe.length - 1 ? S.tableRowLast : S.tableRow} key={i} wrap={false}>
                  <Text style={[S.tableCell, S.tableCellFirst]}>{row.servico ?? "—"}</Text>
                  <Text style={S.tableCell}>{row.fonte ? `#${row.fonte}` : "—"}</Text>
                  <Text style={S.tableCell}>{row.status === "fechado" ? "Fechada" : row.status === "agendado" ? "Agendada" : "—"}</Text>
                  <Text style={S.tableCell}>{fmtMoney(row.valor)}</Text>
                </View>
              ))}
            </View>
            {conversoesOverflow > 0 ? (
              <Text style={S.tableMore}>+{conversoesOverflow} conversã{conversoesOverflow > 1 ? "es" : "o"} não detalhada{conversoesOverflow > 1 ? "s" : ""} no comentário.</Text>
            ) : null}
          </View>
        ) : null}

        {funnelValues.length >= 2 ? (
          <View style={S.section} wrap={false}>
            <Text style={S.kicker}>Visão geral</Text>
            <Text style={S.sectionTitle}>Funil de vendas</Text>
            <View style={S.funnelRow}>
              <FunnelSvg labels={funnelLabels} values={funnelValues} />
              <ResultPanel
                label={funnelLabels.at(-1) ?? "Vendas"}
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

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
