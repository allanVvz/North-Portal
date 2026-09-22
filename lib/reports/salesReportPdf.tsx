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
import type { CampaignBlock } from "@/lib/performanceTemplates";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { AdaptiveInterpretation } from "@/lib/ai/adaptiveFeedback";
import type { MetaPost } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver, CampaignBlocksSection } from "./campaignBlockKpis";
import { attributionOf, type InformedTotals } from "./conversionMode";
import {
  creativeBadges, creativeHighlights, creativeRows, mediaOutcome, mediaTotals, money, num, objectiveRows,
  type Badge, type MediaOutcome, signed,
} from "./adsInsights";
import { costLadder, focusOf, heroFor, resultAnalysis, resultFunnel, supportFigures, type FocusContext, type HistoryPoint } from "./conversionFocus";
import type { PreviewAsset } from "./creativePreviews";
import type { ReportContext } from "./conversionReportPlanning";
import type { HideTarget } from "./reportInstructions";
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
  /** Custo por seguidor novo declarado pela operação para este período. */
  custoPorNovoSeguidor?: number | null;
  /** Ganho de seguidores do período anterior, quando informado. */
  prevSeguidoresNovos?: number | null;
  prevTotals?: SalesPrevTotals | null;
  /** Série da conversão, semanas anteriores E a atual. */
  history?: HistoryPoint[] | null;
  previews?: Record<string, PreviewAsset>;
  /** Métricas que NENHUMA integração entrega e que a equipe informou no
   *  comentário — verba disponível é a primeira. Chegam como lista porque o
   *  conjunto é configurável por cliente (`collect_metric_keys`): o relatório
   *  mostra o que foi pedido, sem o código conhecer cada tag. */
  informados?: { label: string; value: number; kind: "count" | "money" }[];
  /** Alvos que um pedido humano mandou esconder ("remova o comentário sobre
   *  seguidores", "retire o % comparativo"). Vem de
   *  lib/reports/reportInstructions.ts, através da ocorrência. */
  hidden?: HideTarget[];
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

function campaignObjectiveText(campaignName: string, resultLabel: string): string {
  const name = campaignName || "—";
  const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const normalizedResult = resultLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return normalizedName.includes(normalizedResult) ? name : `${name} · ${resultLabel}`;
}

function SalesReportDocument(input: SalesReportInput) {
  const { clientName, period, config, campaignPosts, adPosts, prevAdPosts, prevCampaignPosts, conversoes, prevConversoes, prevTotals, history, previews, generatedAt } = input;

  // O que um pedido humano mandou esconder. "Remova o comentário sobre
  // seguidores novos" e "retire dos dados o % comparativo com o período
  // anterior" (CRIS, 22/09) são pedidos legítimos e recorrentes; sem isto eles
  // eram registrados e respondidos, mas o bloco continuava no PDF.
  const escondido = new Set(input.hidden ?? []);
  const esconde = (alvo: HideTarget) => escondido.has(alvo);

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
  const { postBlock } = blockResolver(config, adPosts);
  // Em templates com Mensagens, a conversa é uma etapa real da jornada antes
  // do resultado de seguidores — mesmo quando o foco do feedback é perfil.
  ctx.hasMessageObjective = campaignPosts.some((post) => postBlock(post) === "mensagens");
  ctx.hasProfileObjective = campaignPosts.some((post) => postBlock(post) === "trafego_perfil");
  const objectives = objectiveRows(campaignPosts, prevCampaignPosts, postBlock, outcome);
  const { rows: creatives } = creativeRows(adPosts, outcome, postBlock);
  const prevCreatives = prevAdPosts?.length ? creativeRows(prevAdPosts, outcome, postBlock).rows : [];
  const badges = creativeBadges(creatives, outcome, prevCreatives);
  const rankedHighlights = creativeHighlights(creatives, badges, outcome, 4);
  const highlightedIds = new Set(rankedHighlights.map((item) => item.row.adId));
  const fallbackHighlights = creatives
    .filter((row) => !highlightedIds.has(row.adId))
    .sort((a, b) => (b.result - a.result) || (b.spend - a.spend) || (b.impressions - a.impressions))
    .slice(0, Math.max(0, 4 - rankedHighlights.length))
    .map((row) => ({ row, badges: [] as Badge[] }));
  const highlights = [...rankedHighlights, ...fallbackHighlights];

  // ---- leitura ----
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

  // O que a API não entrega vem do comentário. Fica em faixa própria, e não
  // misturado às figuras de mídia, para o cliente ler de onde veio cada número.
  const informadosSection = (input.informados ?? []).length ? (
    <Section title="Informado pela equipe">
      <FigureRow items={(input.informados ?? []).map((m) => ({
        label: m.label,
        value: m.kind === "money" ? money(m.value) : num(m.value),
        delta: null,
      }))} />
    </Section>
  ) : null;

  const mediaSection = objectives.length ? (
    <Section title="A mídia da semana" aside={media.spend !== null ? `${money(media.spend)} investidos` : undefined}>
      <DataTable
        columns={[
          { key: "obj", label: "Objetivo", flex: 1.5 },
          { key: "spend", label: "Investimento", align: "right" },
          { key: "reach", label: "Alcance", align: "right" },
          { key: "result", label: "Resultado", align: "right", flex: 1.25 },
          { key: "cost", label: "Custo por resultado", align: "right", flex: 1.15 },
        ]}
        rows={objectives.map((o) => ({
          obj: { text: o.label, strong: true },
          spend: { text: money(o.spend) },
          reach: { text: num(o.reach) },
          result: { text: o.result === null ? "—" : `${num(o.result)} ${o.resultLabel.toLocaleLowerCase("pt-BR")}`, strong: true },
          cost: { text: o.costPerResult === null ? "—" : money(o.costPerResult) },
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
        O crescimento semanal permaneceu positivo{prevFollowersGain !== null && followersGain < prevFollowersGain ? ", mesmo com ritmo abaixo da referência anterior" : ""}. A base total continuou avançando. {media.profileVisits !== null ? `As ${num(media.profileVisits)} visitas ao perfil compõem a jornada observada, ` : "As visitas ao perfil compõem a jornada observada, "}mas não permitem atribuir automaticamente cada novo seguidor aos anúncios.
      </Text>
    </Section>
  ) : null;

  const audienceRows = [
    followersGain !== null ? { label: "Seguidores adquiridos na semana", current: followersGain, previous: prevFollowersGain } : null,
    cur.seguidores !== null ? { label: "Total do perfil", current: cur.seguidores, previous: prevFollowersTotal } : null,
  ].filter((metric): metric is { label: string; current: number; previous: number | null } => metric !== null);

  const audienceGrowthSection = audienceRows.length ? (
    <Section title="Crescimento de audiência" aside="Resultado informado">
      <DataTable
        columns={[
          { key: "metric", label: "Indicador", flex: 1.8 }, { key: "current", label: "Atual", align: "right" },
          { key: "previous", label: "Referência anterior", align: "right", flex: 1.2 }, { key: "difference", label: "Diferença", align: "right" },
          { key: "percent", label: "Variação", align: "right" },
        ]}
        rows={audienceRows.map((metric) => {
          const delta = comparison(metric.current, metric.previous);
          return {
            metric: { text: metric.label, strong: true }, current: { text: num(metric.current) },
            previous: { text: metric.previous === null ? "—" : num(metric.previous) },
            difference: { text: delta.difference }, percent: { text: delta.percent },
          };
        })}
      />
    </Section>
  ) : null;

  const conversionHistorySection = series.filter((point) => [point.vendas, point.agendamentos, point.receita, point.seguidores].some((value) => value !== null)).length >= 3 ? (
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

  // Segment templates start with the global journey, then keep KPIs and
  // creatives together in each real campaign objective.
  if (config.reportKpiPolicy !== "generic") {
    // Só entra quando a equipe efetivamente escreveu uma análise. Contexto
    // interno, autoria e metatexto nunca são expostos ao cliente.
    const operationalReading = [...new Set((input.adaptiveContext?.context ?? [])
      .map((item) => item.text.replace(/\s+/g, " ").trim())
      .filter(Boolean))]
      .slice(-2);
    const resultItems = [
      cur.vendas !== null ? { label: "Vendas", value: num(cur.vendas), delta: null } : null,
      cur.agendamentos !== null ? { label: "Agendamentos", value: num(cur.agendamentos), delta: null } : null,
      cur.receita !== null ? { label: "Receita", value: money(cur.receita), delta: null } : null,
    ].filter((item): item is { label: string; value: string; delta: null } => item !== null);
    const creativeTableForBlock = (block: CampaignBlock) => {
      const rows = creatives.filter((creative) => creative.block === block);
      if (!rows.length) return null;
      const groups = [...rows.reduce((byCampaign, creative) => {
        const name = creative.campaignName.trim() || "Campanha";
        const current = byCampaign.get(name) ?? [];
        current.push(creative);
        byCampaign.set(name, current);
        return byCampaign;
      }, new Map<string, typeof rows>())];
      const cardFor = (creative: typeof rows[number]) => {
        const view = creativeCardView(creative, badges.get(creative.adId) ?? [], outcome, previews);
        return {
          ...view,
          metrics: [
            { label: creative.resultLabel.toLocaleLowerCase("pt-BR"), value: num(creative.result) },
            { label: "investidos", value: money(creative.spend) },
          ],
        };
      };
      return (
        <View style={{ marginTop: 10 }}>
          {groups.map(([campaignName, campaignCreatives]) => {
            const highlight = [...campaignCreatives].sort((a, b) => (b.result - a.result) || (b.spend - a.spend))[0];
            // O destaque não se repete na lista. A lista mantém o preview
            // pequeno de cada peça restante, como no relatório anterior.
            const remaining = campaignCreatives
              .filter((creative) => creative.adId !== highlight.adId)
              .sort((a, b) => (b.result - a.result) || (b.spend - a.spend));
            return (
              <View key={campaignName} style={{ marginTop: 8 }}>
                <Text style={[T.cardBadge, { color: "#54706b", marginBottom: 4 }]}>{campaignName}</Text>
                <Text style={[T.cardMetricLabel, { marginBottom: 4 }]}>Destaque</Text>
                <CreativeCards items={[cardFor(highlight)]} layout={{ maxLines: 2 }} />
                {remaining.length ? <View style={{ marginTop: 8 }}>
                  <DataTable
                    columns={[
                      { key: "thumb", label: "", width: 26 },
                      { key: "creative", label: "Outros criativos", flex: 2.4 },
                      { key: "investment", label: "Investimento", align: "right" },
                      { key: "result", label: highlight.resultLabel, align: "right", flex: 1.2 },
                    ]}
                    rows={remaining.map((creative) => ({
                      thumb: { text: "", image: previews?.[creative.adId]?.dataUri ?? null },
                      creative: { text: creative.name, strong: true },
                      investment: { text: money(creative.spend) },
                      result: { text: num(creative.result) },
                    }))}
                  />
                </View> : null}
              </View>
            );
          })}
        </View>
      );
    };
    return (
      <Document>
        <Page size="A4" style={T.page} wrap>
          <PageHeader
            eyebrow={clientName}
            title="Relatório de conversão"
            subtitle={`${fullDay(period.from)} a ${fullDay(period.to)}`}
            pill="Conversão"
          />
          {funnel.stages.length ? (
            <Section title="Funil">
              <View style={{ alignItems: "center", paddingVertical: 2 }}>
                <ProportionalFunnel
                  width={Math.min(input.layout?.funnel?.width ?? 300, 300)}
                  layout={{ ...input.layout?.funnel, maxWidth: 300, nodeWidth: 180 }}
                  stages={funnel.stages.filter((stage) => !(esconde("seguidores") && stage.key === "seguidores_novos")).map((stage) => ({
                    label: stage.label,
                    value: stage.key === "seguidores_novos" ? `+${num(stage.value)}` : num(stage.value),
                    numeric: stage.value,
                    base: stage.base,
                  }))}
                  gaps={funnel.gaps}
                />
              </View>
            </Section>
          ) : null}
          {resultItems.length ? <Section title="Resultados informados"><FigureRow items={resultItems} /></Section> : null}
          {informadosSection}
          <CampaignBlocksSection
            config={config}
            posts={campaignPosts}
            // Sem período anterior não há % a calcular: é assim que "retire o %
            // comparativo" some das boxes sem tocar no cálculo de cada KPI.
            prevPosts={esconde("percentual_comparativo") ? [] : prevCampaignPosts}
            adPosts={adPosts}
            kicker="Mídia por objetivo"
            extraKpis={(block) => {
              if (esconde("seguidores")) return [];
              if (block !== "trafego_perfil" || followersGain === null || followersGain <= 0) return [];
              return [
                {
                  label: "Novos seguidores", value: followersGain, previous: null,
                  kind: "number", inverse: false, deltaText: `+${num(followersGain)} informados`, deltaTone: "good" as const,
                },
                ...(input.custoPorNovoSeguidor !== null && input.custoPorNovoSeguidor !== undefined
                  ? [{
                    label: "Custo por novo seguidor", value: input.custoPorNovoSeguidor, previous: null,
                    kind: "money" as const, inverse: true, deltaText: "Informado pela equipe", deltaTone: "neutral" as const,
                  }]
                  : []),
              ];
            }}
            detail={(block) => creativeTableForBlock(block)}
          />
          {operationalReading.length ? (
            <Section title="Leitura da semana">
              <AnalysisList items={operationalReading} />
            </Section>
          ) : null}
          {conversoes.length ? (
            <Section title="Conversões informadas">
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
          {conversionHistorySection}
          <Footer left={`North · ${clientName} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`} />
        </Page>
      </Document>
    );
  }

  const tableHasCampaign = creatives.some((r) => Boolean(r.campaignName.trim()));
  const tableHasCost = creatives.some((r) => r.costPerResult !== null);
  const tableHasShare = creatives.some((r) => r.resultShare !== null);
  const allAdsSection = creatives.length ? (
    <Section title="Contribuição dos anúncios" aside="Todos os anúncios relevantes do período" breakBefore>
      <DataTable columns={[
        { key: "name", label: "Anúncio", flex: tableHasCampaign ? 1.8 : 2.4 },
        ...(tableHasCampaign ? [{ key: "campaign", label: "Campanha / objetivo", flex: 1.5 }] : []),
        { key: "spend", label: "Investimento", align: "right" },
        { key: "result", label: "Resultado", align: "right" },
        ...(tableHasCost ? [{ key: "cost", label: "Custo", align: "right" as const }] : []),
        ...(tableHasShare ? [{ key: "share", label: "Contribuição", align: "right" as const }] : []),
      ]} rows={creatives.map((r) => ({
        name: { text: r.name, strong: true },
        ...(tableHasCampaign ? { campaign: { text: campaignObjectiveText(r.campaignName, r.resultLabel) } } : {}),
        spend: { text: money(r.spend) },
        result: { text: num(r.result) },
        ...(tableHasCost ? { cost: { text: r.costPerResult === null ? "—" : money(r.costPerResult) } } : {}),
        ...(tableHasShare ? { share: { text: r.resultShare === null ? "—" : `${r.resultShare.toFixed(1).replace(".", ",")}%` } } : {}),
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

        {/* O destaque acima da faixa de KPIs (manchete + número de 30pt) saiu por
            decisão do usuário: repetia o que a faixa e o funil já dizem, e no
            foco seguidores era a terceira vez que o mesmo ganho aparecia. */}
        <FigureRow items={figures} />
        {informadosSection}
        {adaptiveSection}
        {conversionNarrative}
        {funnel.stages.length ? (
          <Section title={focus === "seguidores" ? "Do alcance ao perfil" : focus === "midia" ? "Do alcance às conversas" : "Do alcance à venda"}>
            <View style={T.twoCol}>
              <ProportionalFunnel width={analysis.insights.length ? 290 : (input.layout?.funnel?.width ?? 360)} layout={input.layout?.funnel} stages={funnel.stages.map((s) => ({ label: s.label, source: s.source === "feedback" ? "resultado informado" : "mídia", value: s.key === "seguidores_novos" ? `+${num(s.value)}` : num(s.value), numeric: s.value, base: s.base }))} gaps={focus === "seguidores" ? [] : funnel.gaps} />
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
        {audienceGrowthSection}

        <Footer left={`North · ${clientName} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`} note={footnote} />
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
