// PDF do "Relatório de conversão" (Automação 2 — relatorio_conversao).
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
import type { AdaptiveInterpretation } from "@/lib/ai/adaptiveFeedback";
import type { MetaPost } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver } from "./campaignBlockKpis";
import { attributionOf, type InformedTotals } from "./conversionMode";
import {
  creativeBadges, creativeHighlights, creativeRows, mediaOutcome, mediaTotals, money, num, objectiveRows,
  type MediaOutcome, signed,
} from "./adsInsights";
import { costLadder, focusOf, heroFor, resultAnalysis, resultFunnel, supportFigures, type FocusContext, type HistoryPoint } from "./conversionFocus";
import type { PreviewAsset } from "./creativePreviews";
import type { ReportContext } from "./conversionReportPlanning";
import { creativeCardView, fullDay, shortDay, type TrafficFinalView } from "./adsReportPdf";
import {
  AnalysisList, CreativeCards, DataTable, FigureRow, Footer, Headline, HeroFigure,
  PageHeader, ProportionalFunnel, RankBars, Section, T, W, type LayoutPlan,
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
  /** Entendimento auditável do North IA: contexto, precisão e trade-offs. */
  adaptiveContext?: AdaptiveInterpretation;
  /** Finalized view from the technical ads report. */
  trafficFinalView?: TrafficFinalView | null;
  reportContext?: ReportContext;
  layoutPlan?: LayoutPlan;
  /** Optional renderer plan; omitted callers retain the legacy layout. */
  layout?: LayoutPlan;
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

function comparison(current: number, previous: number | null) {
  if (previous === null) return { difference: "—", percent: "—" };
  const diff = current - previous;
  return {
    difference: signed(diff),
    percent: previous === 0 ? "—" : `${(diff / previous * 100).toFixed(2).replace("-", "−")}%`,
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
  if (input.trafficFinalView?.reach !== null && input.trafficFinalView?.reach !== undefined) media.reach = input.trafficFinalView.reach;
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
  const highlights = creativeHighlights(creatives, badges, outcome, 4);

  // ---- leitura ----
  const hero = heroFor(ctx);
  const figures = supportFigures(ctx);
  const funnel = resultFunnel(ctx);
  const attribution = attributionOf(cur.vendas, conversoes);
  const top = highlights[0]?.row;
  const analysis = resultAnalysis({ ...ctx, attribution, topCreative: top ? { name: top.name, clicks: top.clicks, conversations: top.conversations, spend: top.spend } : null });
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

  const creativeSection = highlights.length ? (
    <Section title={creativeSectionTitle} lead={<CreativeCards items={highlights.map((h) => creativeCardView(h.row, h.badges, outcome, previews))} layout={input.layout?.creativeCards} />} />
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

  const adaptiveSection = null; /* client PDF excludes internal context and authors */
  /*
    input.adaptiveContext.context.length
    || input.adaptiveContext.tradeoffs.length
    || input.adaptiveContext.claims.some((claim) => claim.precision !== "exata")
  ) ? (
    <Section title="Contexto e leitura do período">
      {input.adaptiveContext.context.map((item) => (
        <Text key={`${item.sourceTaskId}:${item.sourceCommentAt}`} style={T.note}>
          Contexto informado por {item.author}: {item.text}
        </Text>
      ))}
      {input.adaptiveContext.claims.some((claim) => claim.precision !== "exata") ? (
        <Text style={T.note}>
          Dados aproximados: os indicadores marcados como aproximados, estimados ou em faixa foram mantidos com essa precisão; comparações evitam precisão artificial.
        </Text>
      ) : null}
      {input.adaptiveContext.tradeoffs.map((tradeoff, index) => (
        <Text key={`${index}:${tradeoff}`} style={T.note}>Decisão de leitura: {tradeoff}</Text>
      ))}
    </Section>
  ) : null; */

  const narrativePlan = input.layout?.narrative ?? { placement: "first_page" as const, maxParagraphs: 1, maxChars: 560 };
  const clipNarrative = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length <= (narrativePlan.maxChars ?? 720)
      ? normalized
      : `${normalized.slice(0, Math.max(1, (narrativePlan.maxChars ?? 720) - 1)).trimEnd()}…`;
  };
  const aiNarrative = (input.reportContext?.narrative ?? [])
    .filter((item) => item.text.trim())
    .slice(0, narrativePlan.maxParagraphs ?? 1)
    .map((item) => ({ ...item, text: clipNarrative(item.text) }));
  const conversionNarrative = aiNarrative.length ? (
    <Section title="Leitura do período" breakBefore={narrativePlan.placement === "next_page"}>
      {aiNarrative.map((item, index) => <Text key={`${item.kind}:${index}`} style={T.narrativeText}>{item.text}</Text>)}
    </Section>
  ) : focus === "seguidores" && followersGain !== null ? (
    <Section title="Leitura do período" breakBefore={narrativePlan.placement === "next_page"}>
      <Text style={T.narrativeText}>
        {num(followersGain)} seguidores adquiridos no período. {prevFollowersGain !== null
          ? `Em comparação à referência anterior de ${num(prevFollowersGain)} seguidores, a variação foi de ${signed(followersGain - prevFollowersGain)} (${((followersGain - prevFollowersGain) / prevFollowersGain * 100).toFixed(2).replace("-", "−")}%). `
          : "A comparação com o período anterior não foi informada. "}
        {cur.seguidores !== null && prevFollowersTotal !== null ? `O perfil encerrou o período com ${num(cur.seguidores)} seguidores, ${num(followersGain)} acima da base registrada de ${num(prevFollowersTotal)}. ` : ""}
        A mídia alcançou {media.reach === null ? "um público não informado" : `${num(media.reach)} pessoas`} e gerou {media.profileVisits === null ? "visitas ao perfil em volume não informado" : `${num(media.profileVisits)} visitas ao perfil`}. Esse volume compõe a jornada observada, mas não atribui automaticamente cada novo seguidor aos anúncios.
      </Text>
    </Section>
  ) : null;

  const confirmedMetrics = [
    followersGain !== null ? { label: "Seguidores adquiridos", current: followersGain, previous: prevFollowersGain, source: "Resultado informado" } : null,
    cur.seguidores !== null ? { label: "Base total de seguidores", current: cur.seguidores, previous: prevFollowersTotal, source: "Resultado informado" } : null,
    cur.vendas !== null ? { label: "Vendas", current: cur.vendas, previous: prev?.vendas ?? null, source: "Resultado informado" } : null,
    cur.agendamentos !== null ? { label: "Agendamentos", current: cur.agendamentos, previous: prev?.agendamentos ?? null, source: "Resultado informado" } : null,
    cur.receita !== null ? { label: "Receita", current: cur.receita, previous: prev?.receita ?? null, source: "Resultado informado", money: true } : null,
  ].filter((metric): metric is { label: string; current: number; previous: number | null; source: string; money?: boolean } => metric !== null);

  const indicatorsSection = confirmedMetrics.length ? (
    <Section title="Indicadores confirmados">
      <DataTable
        columns={[
          { key: "metric", label: "Indicador", flex: 1.6 }, { key: "current", label: "Atual", align: "right" },
          { key: "previous", label: "Referência", align: "right" }, { key: "difference", label: "Diferença", align: "right" },
          { key: "percent", label: "%", align: "right" }, { key: "source", label: "Fonte", flex: 1.2 },
        ]}
        rows={confirmedMetrics.map((metric) => {
          const delta = comparison(metric.current, metric.previous);
          const format = (value: number) => metric.money ? money(value) : num(value);
          return {
            metric: { text: metric.label, strong: true }, current: { text: format(metric.current) },
            previous: { text: metric.previous === null ? "—" : format(metric.previous) },
            difference: { text: delta.difference }, percent: { text: delta.percent }, source: { text: metric.source },
          };
        })}
      />
    </Section>
  ) : null;

  const conversionHistorySection = series.length > 1 ? (
    <Section title="Histórico de conversão">
      <DataTable
        columns={[
          { key: "period", label: "Período", flex: 1.2 }, { key: "followers", label: "Seguidores", align: "right" },
          { key: "sales", label: "Vendas", align: "right" }, { key: "bookings", label: "Agendamentos", align: "right" },
          { key: "revenue", label: "Receita", align: "right" },
        ]}
        rows={series.slice(-8).map((point) => ({
          period: { text: shortDay(point.periodTo) }, followers: { text: point.seguidores === null ? "—" : num(point.seguidores) },
          sales: { text: point.vendas === null ? "—" : num(point.vendas) }, bookings: { text: point.agendamentos === null ? "—" : num(point.agendamentos) },
          revenue: { text: point.receita === null ? "—" : money(point.receita) },
        }))}
      />
    </Section>
  ) : null;

  const allAdsSection = creatives.length ? (
    <Section title="Contribuição dos anúncios" aside="Todos os anúncios relevantes do período">
      <DataTable columns={[
        { key: "thumb", label: "", width: 26 }, { key: "name", label: "Anúncio", flex: 1.7 },
        { key: "campaign", label: "Campanha / objetivo", flex: 1.5 }, { key: "spend", label: "Investimento", align: "right" },
        { key: "result", label: "Resultado", align: "right" }, { key: "cost", label: "Custo", align: "right" }, { key: "share", label: "Contribuição", align: "right" },
      ]} rows={creatives.map((r) => ({
        thumb: { text: "", image: previews?.[r.adId]?.dataUri ?? null }, name: { text: r.name, strong: true },
        campaign: { text: `${r.campaignName || "—"} · ${outcome === "visitas" ? "Visitas ao perfil" : "Conversas"}` }, spend: { text: money(r.spend) },
        result: { text: num(r.result) }, cost: { text: r.costPerResult === null ? "—" : money(r.costPerResult) },
        share: { text: r.resultShare === null ? "—" : `${r.resultShare.toFixed(1).replace(".", ",")}%` },
      }))} />
    </Section>
  ) : null;

  return (
    <Document>
      <Page size="A4" style={T.page} wrap>
        <PageHeader
          eyebrow={clientName}
          title="Relatório de conversão"
          subtitle={`${fullDay(period.from)} a ${fullDay(period.to)}${comparedRange ? ` · comparado com ${shortDay(comparedRange.from)} a ${shortDay(comparedRange.to)}` : ""}`}
          pill="Conversão"
        />

        {focus === "vendas" || focus === "agendamentos" ? <Headline text={analysis.headline} /> : null}
        <HeroFigure value={hero.value} label={hero.label} caption={hero.caption || undefined} delta={hero.delta} />
        <FigureRow items={figures} />
        {adaptiveSection}
        {conversionNarrative}
        {indicatorsSection}

        {funnel.stages.length ? (
          <Section title={focus === "seguidores" ? "Do alcance ao perfil" : focus === "midia" ? "Do alcance às conversas" : "Do alcance à venda"}>
            <View style={T.twoCol}>
              <ProportionalFunnel width={analysis.insights.length ? 290 : W} stages={funnel.stages.map((s) => ({ label: `${s.label} · ${s.source === "feedback" ? "resultado informado" : "mídia"}`, value: s.key === "seguidores_novos" ? `+${num(s.value)}` : num(s.value), numeric: s.value, base: s.base }))} gaps={focus === "seguidores" ? [] : funnel.gaps} />
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
            {creativeSection}
            {allAdsSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "vendas" ? (
          <>
            {ladder.length || origins.length ? (
              // A taxa agendamento → venda já está no funil; aqui fica o custo e a origem.
              <Section title={origins.length ? "Custo e origem das vendas" : "Custo de mídia por etapa"}>
                <View style={T.twoCol}>
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
            {allAdsSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "agendamentos" ? (
          <>
            {creativeSection}
            {allAdsSection}
            {mediaSection}
          </>
        ) : null}

        {focus === "midia" ? (
          <>
            {creativeSection}
            {allAdsSection}
            {mediaSection}
          </>
        ) : null}

        {conversionHistorySection}

        <Footer left={`North · ${clientName} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`} note={footnote} />
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
