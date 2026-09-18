// PDF do "Relatório de resultados" (Automação 2 — relatorio_vendas).
//
// Muda de forma conforme o feedback. Plano: docs/reporting/adaptive-report-plan.md §2–§3.
// A conversão mais importante informada (conversionFocus.focusOf) decide a
// figura principal, o funil, os blocos e a ordem:
//
//   seguidores  → crescimento de audiência: +N grande, evolução do perfil,
//                 criativo que mais levou ao perfil
//   vendas      → receita/vendas grande, eficiência comercial, origem, histórico,
//                 vendas descritas, criativo que mais gerou conversas
//   agendamentos→ agendamentos grande, histórico, criativo
//   nada        → relatório curto com a mídia
//
// Regras: ausência não vira seção nem nota; uma única nota metodológica no rodapé.

import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { MetaPost } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver } from "./campaignBlockKpis";
import { attributionOf, type InformedTotals } from "./conversionMode";
import {
  creativeBadges, creativeHighlights, creativeRows, mediaOutcome, mediaTotals, money, num, objectiveRows,
  type MediaOutcome,
} from "./adsInsights";
import { costLadder, focusOf, heroFor, historyView, resultAnalysis, resultFunnel, supportFigures, type FocusContext, type HistoryPoint } from "./conversionFocus";
import type { PreviewAsset } from "./creativePreviews";
import { creativeCardView, fullDay, shortDay } from "./adsReportPdf";
import {
  AnalysisList, ColumnsChart, ComparisonFigure, CreativeCards, DataTable, FigureRow, Footer, Headline, HeroFigure, LineChart,
  PageHeader, ProportionalFunnel, RankBars, Section, T, W,
} from "./reportBlocks";

registerReportFonts();

export type SalesReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  campaignPosts: MetaPost[];
  adPosts: MetaPost[];
  prevCampaignPosts: MetaPost[];
  prevAdPosts?: MetaPost[];
  conversoes: ConversionRow[];
  prevConversoes?: ConversionRow[];
  receitaTotal?: number | null;
  vendasTotal?: number | null;
  agendamentosTotal?: number | null;
  /** Total de seguidores do perfil ao fim do período (snapshot, não o ganho). */
  seguidores?: number | null;
  /** Seguidores ganhos no período, informados diretamente no feedback. */
  seguidoresNovos?: number | null;
  /** Ganho de seguidores do período anterior, quando informado. */
  prevSeguidoresNovos?: number | null;
  prevTotals?: SalesPrevTotals | null;
  /** Série da conversão, semanas anteriores E a atual. */
  history?: HistoryPoint[] | null;
  previews?: Record<string, PreviewAsset>;
  generatedAt: Date;
};

export type SalesPrevTotals = {
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
  seguidoresNovos?: number | null;
  from?: string | null;
  to?: string | null;
};

function totalsOf(conversoes: ConversionRow[]) {
  return {
    agendamentos: conversoes.length,
    vendas: conversoes.filter((c) => c.status === "fechado").length,
    receita: conversoes.reduce((sum, c) => sum + (c.valor ?? 0), 0),
  };
}

function SalesReportDocument(input: SalesReportInput) {
  const { clientName, period, config, campaignPosts, adPosts, prevAdPosts, prevCampaignPosts, conversoes, prevConversoes, prevTotals, history, previews, generatedAt } = input;

  // ---- o que foi informado (null = não informado) ----
  const temLinhas = conversoes.length > 0;
  const linhas = totalsOf(conversoes);
  const vendas = input.vendasTotal ?? (temLinhas ? linhas.vendas : null);
  const agendados = input.agendamentosTotal ?? (temLinhas ? linhas.agendamentos : null);
  const cur: InformedTotals = {
    vendas,
    agendamentos: agendados !== null && vendas !== null ? Math.max(agendados, vendas) : agendados,
    receita: input.receitaTotal ?? (temLinhas && linhas.receita > 0 ? linhas.receita : null),
    seguidores: input.seguidores ?? null,
    seguidoresGanho: input.seguidoresNovos ?? null,
  };
  const prevLinhas = prevConversoes?.length ? totalsOf(prevConversoes) : null;
  const prev: InformedTotals | null = prevTotals || prevLinhas
    ? {
        vendas: prevTotals?.vendas ?? prevLinhas?.vendas ?? null,
        agendamentos: prevTotals?.agendamentos ?? prevLinhas?.agendamentos ?? null,
        receita: prevTotals?.receita ?? (prevLinhas && prevLinhas.receita > 0 ? prevLinhas.receita : null),
        seguidores: prevTotals?.seguidores ?? null,
        seguidoresGanho: prevTotals?.seguidoresNovos ?? null,
      }
    : null;

  // ---- série ----
  const series: HistoryPoint[] = [...(history ?? [])].sort((a, b) => a.periodTo.localeCompare(b.periodTo));
  if (!series.some((h) => h.periodTo === period.to)) series.push({ periodTo: period.to, ...cur });
  const idx = series.findIndex((h) => h.periodTo === period.to);
  const prevFollowersTotal = prevTotals?.seguidores ?? (idx > 0 ? series[idx - 1].seguidores : null);
  // Um feedback no formato "47 seguidores novos" já informa a conversão
  // diretamente. Nunca subtraia esse ganho de uma base anterior: a subtração
  // só vale quando os dois valores são snapshots do total do perfil.
  const followersGain = input.seguidoresNovos != null
    ? input.seguidoresNovos
    : cur.seguidores !== null && prevFollowersTotal !== null
      ? cur.seguidores - prevFollowersTotal
      : null;
  const prevFollowersGain = input.prevSeguidoresNovos ?? prevTotals?.seguidoresNovos ?? (idx >= 2 && series[idx - 1].seguidores !== null && series[idx - 2].seguidores !== null
    ? (series[idx - 1].seguidores as number) - (series[idx - 2].seguidores as number)
    : null);

  const focus = focusOf(cur);
  const media = mediaTotals(campaignPosts);
  const prevMedia = prevCampaignPosts.some((p) => p.source === "paid") ? mediaTotals(prevCampaignPosts) : null;
  const ctx: FocusContext = { kind: focus, cur, prev, media, prevMedia, followersGain, prevFollowersGain, prevFollowersTotal };

  const comparedRange = prevTotals?.from && prevTotals?.to ? { from: prevTotals.from, to: prevTotals.to } : prev || prevMedia ? previousPeriod(period) : null;

  // ---- mídia e criativos ----
  const outcome: MediaOutcome = focus === "seguidores" ? "visitas" : mediaOutcome(media);
  const { postBlock } = blockResolver(config);
  const objectives = objectiveRows(campaignPosts, prevCampaignPosts, postBlock, outcome);
  const { rows: creatives } = creativeRows(adPosts, outcome);
  const prevCreatives = prevAdPosts?.length ? creativeRows(prevAdPosts, outcome).rows : [];
  const badges = creativeBadges(creatives, outcome, prevCreatives);
  const highlights = creativeHighlights(creatives, badges, outcome, 2);

  // ---- leitura ----
  const hero = heroFor(ctx);
  const figures = supportFigures(ctx);
  const funnel = resultFunnel(ctx);
  const attribution = attributionOf(cur.vendas, conversoes);
  const top = highlights[0]?.row;
  const analysis = resultAnalysis({ ...ctx, attribution, topCreative: top ? { name: top.name, clicks: top.clicks, conversations: top.conversations, spend: top.spend } : null });
  const hist = historyView(focus, series);
  const ladder = costLadder(media.spend, media.conversations, cur);

  const origins = Object.entries(attribution.porFonte)
    .map(([fonte, t]) => ({ label: `Fonte #${fonte}`, value: t!.vendas, text: `${num(t!.vendas)} ${t!.vendas === 1 ? "venda" : "vendas"}${t!.receita !== null ? ` · ${money(t!.receita)}` : ""}` }))
    .sort((a, b) => b.value - a.value);
  const semOrigem = attribution.informadas !== null ? attribution.informadas - attribution.comOrigem : 0;
  if (origins.length && semOrigem > 0) origins.push({ label: "Sem origem", value: semOrigem, text: `${num(semOrigem)} ${semOrigem === 1 ? "venda" : "vendas"}`, muted: true } as never);

  const footnote = focus === "seguidores"
    ? "Seguidores novos podem incluir pessoas que chegaram ao perfil sem passar pelos anúncios."
    : focus === "vendas" || focus === "agendamentos"
      ? "Resultados comerciais podem incluir canais além da mídia paga."
      : null;

  const creativeSectionTitle = focus === "seguidores"
    ? highlights.length > 1 ? "Os anúncios que mais levaram gente ao perfil" : "O anúncio que mais levou gente ao perfil"
    : highlights.length > 1 ? "Os criativos que mais contribuíram" : "O criativo que mais contribuiu";

  // Em seguidores, a comparação de 2 semanas só repetiria a figura principal
  // ("passou de 1.214 para 1.251") — a seção aparece quando vira gráfico.
  const showHistory = hist.type === "chart" || (hist.type === "comparison" && focus !== "seguidores");
  const historySection = !showHistory ? null : (
    <Section title={hist.type === "chart" ? hist.title : "Em relação à semana anterior"} aside={hist.type === "chart" ? hist.summary ?? undefined : undefined}>
      {hist.type === "comparison" ? <ComparisonFigure items={hist.items} /> : null}
      {hist.type === "chart" && hist.form === "line" ? <LineChart periods={hist.periods} values={hist.series[0].values} height={100} /> : null}
      {hist.type === "chart" && hist.form === "columns" ? <ColumnsChart periods={hist.periods} series={hist.series.map((s) => ({ label: s.label, values: s.values }))} /> : null}
    </Section>
  );

  const creativeSection = highlights.length ? (
    <Section title={creativeSectionTitle} lead={<CreativeCards items={highlights.map((h) => creativeCardView(h.row, h.badges, outcome, previews))} />} />
  ) : null;

  const mediaSection = objectives.length ? (
    <Section title="A mídia da semana" aside={media.spend !== null ? `${money(media.spend)} investidos` : undefined}>
      <DataTable
        columns={[
          { key: "obj", label: "Objetivo", flex: 1.5 },
          { key: "spend", label: "Investimento", align: "right" },
          { key: "reach", label: "Alcance", align: "right" },
          { key: "clicks", label: "Cliques", align: "right" },
          { key: "visits", label: "Visitas", align: "right" },
          { key: "conv", label: "Conversas", align: "right" },
        ]}
        rows={objectives.map((o) => ({
          obj: { text: o.label, strong: true },
          spend: { text: money(o.spend) },
          reach: { text: num(o.reach) },
          clicks: { text: num(o.clicks) },
          visits: { text: num(o.visits) },
          conv: { text: num(o.conversations) },
        }))}
      />
    </Section>
  ) : null;

  return (
    <Document>
      <Page size="A4" style={T.page} wrap>
        <PageHeader
          eyebrow={clientName}
          title="Relatório de resultados"
          subtitle={`${fullDay(period.from)} a ${fullDay(period.to)}${comparedRange ? ` · comparado com ${shortDay(comparedRange.from)} a ${shortDay(comparedRange.to)}` : ""}`}
          pill="Relatório 2"
        />

        {focus === "vendas" || focus === "agendamentos" ? <Headline text={analysis.headline} /> : null}
        <HeroFigure value={hero.value} label={hero.label} caption={hero.caption || undefined} delta={hero.delta} />
        <FigureRow items={figures} />

        {funnel.stages.length ? (
          <Section title={focus === "seguidores" ? "Do alcance ao perfil" : focus === "midia" ? "Do alcance às conversas" : "Do alcance à venda"}>
            <View style={T.twoCol} wrap={false}>
              <ProportionalFunnel width={analysis.insights.length ? 290 : W} stages={funnel.stages.map((s) => ({ label: s.label, value: s.key === "seguidores_novos" ? `+${num(s.value)}` : num(s.value), numeric: s.value, base: s.base }))} gaps={funnel.gaps} />
              {analysis.insights.length ? (
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <AnalysisList items={analysis.insights} />
                </View>
              ) : null}
            </View>
          </Section>
        ) : null}

        {focus === "seguidores" ? (
          <>
            {historySection}
            {creativeSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "vendas" ? (
          <>
            {ladder.length || origins.length ? (
              // A taxa agendamento → venda já está no funil; aqui fica o custo e a origem.
              <Section title={origins.length ? "Custo e origem das vendas" : "Custo de mídia por etapa"}>
                <View style={T.twoCol} wrap={false}>
                  <View style={{ flex: 1 }}>
                    {ladder.length ? (
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        {ladder.map((s) => (
                          <View key={s.label} style={{ width: 78 }}>
                            <Text style={{ fontSize: 12, fontWeight: 700 }}>{s.value}</Text>
                            <Text style={T.cardMetricLabel}>de mídia {s.label}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  {origins.length ? (
                    <View style={{ width: 250 }}>
                      <RankBars rows={origins} width={250} />
                    </View>
                  ) : null}
                </View>
              </Section>
            ) : null}
            {historySection}
            {conversoes.length ? (
              <Section title="Vendas descritas" aside={cur.vendas !== null && conversoes.length < cur.vendas ? `${conversoes.length} de ${cur.vendas} descritas` : undefined}>
                <DataTable
                  columns={[
                    { key: "servico", label: "Serviço", flex: 2.4 },
                    { key: "fonte", label: "Origem" },
                    { key: "status", label: "Situação" },
                    { key: "valor", label: "Valor", align: "right" },
                  ]}
                  rows={[...conversoes].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).map((row) => ({
                    servico: { text: row.servico ?? "—", strong: true },
                    fonte: { text: row.fonte ? `#${row.fonte}` : "—" },
                    status: { text: row.status === "fechado" ? "Fechada" : row.status === "agendado" ? "Agendada" : "—" },
                    valor: { text: row.valor === null ? "—" : money(row.valor) },
                  }))}
                />
              </Section>
            ) : null}
            {creativeSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "agendamentos" ? (
          <>
            {historySection}
            {creativeSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "midia" ? (
          <>
            {creativeSection}
            {mediaSection}
          </>
        ) : null}

        <Footer left={`North · ${clientName} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`} note={footnote} />
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
