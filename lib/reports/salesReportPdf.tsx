// PDF do "Relatório de vendas" (Automação 2 — relatorio_vendas).
//
// Fecha o fluxo de conversão: cruza os números do Meta (tráfego, conversas) com
// as conversões que o responsável lançou no comentário do card manual (via
// lib/ai/extractMetrics). Uma folha A4.
//
// A ordem das seções é a ordem de leitura do dono do negócio, não a ordem em
// que os dados chegam: (1) a frase que resume a semana, (2) resumo do período —
// receita primeiro, custo nenhum (ele vive como base do ROAS), (3) o funil do
// anúncio até a venda, que é a peça que se lê sem legenda, (4) como a mídia
// performou, por objetivo, (5) fonte de tráfego × objetivo, (6) vendas e
// agendamentos detalhados. Sem tag de fonte no template, a conversão por
// objetivo não é rastreável e a seção (4) mostra só a mídia.
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
import { salesHeadline } from "./salesHeadline";

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
  /** Total de seguidores do perfil ao fim do período (snapshot, não o ganho —
   *  ver KNOWN_METRIC_TAGS em lib/metricTags.ts). */
  seguidores?: number | null;
  /** O MESMO conjunto de totais do período anterior deste cliente, lido da
   *  série em `task_metrics` (period_to). É o que transforma "4 vendas" em "4
   *  vs. 5 na semana passada" — sem isto cada PDF é uma ilha e o número não
   *  vira tendência. Preferido sobre derivar de `prevConversoes`: o gestor
   *  pode ter relatado "5 vendas" sem detalhar linha a linha, e aí a contagem
   *  das linhas diria 0 e a variação sairia mentindo. */
  prevTotals?: SalesPrevTotals | null;
  generatedAt: Date;
};

export type SalesPrevTotals = {
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
  /** O período REAL da linha usada como base. Não é necessariamente o período
   *  de calendário imediatamente anterior — uma semana sem relatório deixa um
   *  buraco na série, e a legenda tem que dizer com o que a comparação foi
   *  feita de verdade, não com o que deveria ter existido. */
  from?: string | null;
  to?: string | null;
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
  clientName, period, cadenceLabel, config, campaignPosts, adPosts, prevCampaignPosts, conversoes, prevConversoes, receitaTotal, vendasTotal, agendamentosTotal, seguidores, prevTotals, generatedAt,
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
  // Mesma precedência do período atual: o total relatado vence a contagem das
  // linhas. `prevTotals` (da série em task_metrics) primeiro; as linhas da
  // semana anterior só entram onde o total não veio.
  const prevLinhas = prevConversoes ? totalsOf(prevConversoes) : null;
  const prev: { agendamentos: number | null; vendas: number | null; receita: number | null } | null =
    prevTotals || prevLinhas
      ? {
          agendamentos: prevTotals?.agendamentos ?? prevLinhas?.agendamentos ?? null,
          vendas: prevTotals?.vendas ?? prevLinhas?.vendas ?? null,
          receita: prevTotals?.receita ?? prevLinhas?.receita ?? null,
        }
      : null;
  const spend = totalWhenPresent(campaignPosts, "custo") ?? 0;
  const prevSpend = totalWhenPresent(prevCampaignPosts, "custo") ?? 0;

  const kpi = (label: string, value: NullableMetric, previous: NullableMetric, kind: "money" | "number" | "percent" | "decimal", inverse = false) =>
    ({ label, value, previous, kind, inverse, notIntegrated: false });

  // Ganho de seguidores na semana. `seguidores` é o TOTAL do perfil (snapshot),
  // então o que o cliente quer ler — "+12" — só existe contra a série.
  const seguidoresGanho = seguidores != null && prevTotals?.seguidores != null
    ? seguidores - prevTotals.seguidores
    : null;

  // Ordem = ordem de leitura do dono do negócio: o que entrou primeiro, o custo
  // por último. Investimento saiu daqui de propósito — aparece por bloco na
  // seção de mídia e como base do ROAS logo abaixo; abrir o relatório pelo
  // quanto se gastou enterra o resultado. São 6 cartões: duas linhas cheias no
  // grid de 3, sem órfão na terceira.
  const summaryKpis = [
    kpi("Receita da semana", cur.receita || null, prev?.receita || null, "money"),
    kpi("Vendas fechadas", cur.vendas, prev?.vendas ?? null, "number"),
    kpi("Agendamentos", cur.agendamentos, prev?.agendamentos ?? null, "number"),
    kpi("Ticket médio", ratio(cur.receita, cur.vendas), prev?.receita != null && prev?.vendas != null ? ratio(prev.receita, prev.vendas) : null, "money"),
    { ...kpi("Retorno sobre o anúncio", ratio(cur.receita, spend), prev?.receita != null ? ratio(prev.receita, prevSpend) : null, "decimal"),
      unit: "×",
      hint: spend > 0 ? `sobre ${formatAcquisitionValue(spend, "money")} investidos` : undefined },
    // Seguidores: o total é o valor, o GANHO é a leitura. A variação percentual
    // numa base de centenas ("↑1,45%") não diz nada que "+12" não diga melhor.
    ...(seguidores != null && seguidores > 0
      ? [{ ...kpi("Seguidores", seguidores, null, "number"),
          deltaText: seguidoresGanho === null ? undefined : `${seguidoresGanho >= 0 ? "+" : "−"}${Math.abs(seguidoresGanho)} na semana`,
          deltaTone: (seguidoresGanho === null ? "neutral" : seguidoresGanho >= 0 ? "good" : "bad") as "good" | "bad" | "neutral" }]
      : []),
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
  // #1/#2/#3 cai no bloco do anúncio taggeado com essa fonte. Criativo sem tag
  // fica de fora, e o bloco simplesmente não mostra vendas — o aviso de como
  // ligar a tag é assunto de operação (tela de template), não do PDF que vai
  // pro cliente. O relatório de anúncios não recebe isto.
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

  // Funil agregado — cauda sem dado sai (funnelStageCount). A etapa de
  // seguidores usa o GANHO da semana, nunca o total do perfil: o total é um
  // snapshot de centenas (841) e entraria no meio do funil maior que as etapas
  // à esquerda, sugerindo que aqueles seguidores vieram do anúncio. Mesmo o
  // ganho só entra se couber na ordem decrescente — um funil que alarga no
  // meio é pior que um funil com uma etapa a menos.
  const funnelRaw: { label: string; value: NullableMetric }[] = [
    { label: "Alcance", value: resolveAcquisitionMetric(campaignPosts, "alcance", cm) },
    { label: "Cliques", value: resolveAcquisitionMetric(campaignPosts, "cliquesLink", cm) },
    ...(seguidoresGanho !== null && seguidoresGanho > 0 ? [{ label: "Seguidores novos", value: seguidoresGanho as NullableMetric }] : []),
    { label: "Conversas", value: resolveAcquisitionMetric(campaignPosts, "contatos", cm) ?? 0 },
    { label: "Agendamentos", value: cur.agendamentos },
    { label: "Vendas", value: cur.vendas },
  ];
  // Etapa sem dado nenhum (`null`) sai do funil em qualquer posição — não vira
  // faixa tracejada vazia. Cauda `0` ainda é aparada pelo funnelStageCount.
  const funnelStages = funnelRaw
    .filter((s) => s.value !== null)
    .filter((s, i, arr) => {
      if (s.label !== "Seguidores novos") return true;
      const antes = arr[i - 1]?.value ?? null;
      const depois = arr[i + 1]?.value ?? null;
      return (antes === null || s.value! <= antes) && (depois === null || s.value! >= depois);
    });
  const values = funnelStages.map((s) => s.value);
  const keepN = funnelStageCount(values);
  const funnelLabels = funnelStages.slice(0, keepN).map((s) => s.label);
  const funnelValues = values.slice(0, keepN);

  const dia = (iso: string) => iso.split("-").reverse().join("/");
  const subtitle = `${cadenceLabel} · ${dia(period.from)} a ${dia(period.to)} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`;
  const fmtMoney = (v: NullableMetric) => formatAcquisitionValue(v, "money");

  // A frase que abre o relatório — a única leitura em palavras da semana.
  const headline = salesHeadline({
    receita: cur.receita,
    vendas: cur.vendas,
    agendamentos: cur.agendamentos,
    prev: prev ? { receita: prev.receita, vendas: prev.vendas } : null,
  });
  // Legenda única do comparativo: dita uma vez sob o resumo, em vez de "vs.
  // anterior" repetido em cada cartão. Usa o período REAL da linha comparada.
  // Sem o ano: o subtítulo logo acima já o carimbou, e "29/08 a 04/09" lê mais
  // rápido que a data por extenso repetida duas vezes.
  const diaCurto = (iso: string) => iso.slice(5).split("-").reverse().join("/");
  const comparadoCom = prevTotals?.from && prevTotals?.to
    ? `Comparado com ${diaCurto(prevTotals.from)} a ${diaCurto(prevTotals.to)}.`
    : prev
      ? "Comparado com o período anterior."
      : "Primeira semana da série — ainda sem período anterior para comparar.";

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

        <Text style={S.headline}>{headline}</Text>

        <View style={S.section}>
          <Text style={S.kicker}>Resumo do período</Text>
          <View style={S.grid}>
            {summaryKpis.map((k) => <KpiCard key={k.label} {...k} deltaSuffix="" />)}
          </View>
          <Text style={S.legend}>{comparadoCom}</Text>
        </View>

        {funnelValues.length >= 2 ? (
          <View style={S.section} wrap={false}>
            <Text style={S.kicker}>Do anúncio à venda</Text>
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

        <CampaignBlocksSection
          config={config}
          posts={campaignPosts}
          prevPosts={prevCampaignPosts}
          kicker="Como a mídia performou"
          extraKpis={objetivoExtraKpis}
        />

        <View style={S.section}>
          <Text style={S.kicker}>Fonte de tráfego e objetivo</Text>
          {/* Esta tabela conta só o que foi descrito venda a venda no comentário;
              o resumo lá em cima usa os totais relatados. Sem esta nota os dois
              números ("5 vendas" no topo, "1 venda" aqui) se contradizem na
              mesma folha e o cliente não tem como saber qual vale. */}
          {sourceRows.length ? (
            <Text style={S.legend}>Só as vendas e agendamentos descritos um a um no comentário — o resumo acima usa os totais relatados.</Text>
          ) : null}
          {sourceRows.length ? (
            <View style={S.table}>
              <View style={S.tableRow}>
                <Text style={[S.tableHeaderCell, { flex: 1.3 }]}>Fonte</Text>
                <Text style={[S.tableHeaderCell, { flex: 1.8 }]}>Objetivo</Text>
                <Text style={S.tableHeaderCell}>Invest.</Text>
                <Text style={S.tableHeaderCell}>Conversas</Text>
                <Text style={S.tableHeaderCell}>Agend. detalh.</Text>
                <Text style={S.tableHeaderCell}>Vendas detalh.</Text>
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

        <Text style={S.footer} fixed>North — relatório gerado automaticamente</Text>
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
