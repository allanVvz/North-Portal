// PDF do "Relatório de resultados" (Automação 2 — relatorio_vendas).
//
// Pergunta que responde: O QUE A SEMANA RENDEU PARA O NEGÓCIO — e como a mídia
// se relaciona com isso. Mostra mídia E conversão, mas sempre ancorado na
// CONVERSÃO MAIS IMPORTANTE DA JORNADA INFORMADA (conversionFocus.focusOf):
// venda/receita > agendamento > seguidor. Ela ganha o número grande, a frase de
// abertura, o fim do funil e o histórico; a mídia vem depois, com menos peso.
//
// Ordem de leitura:
//   1. Resultado da semana — faixa com a conversão principal primeiro + leitura.
//   2. Funil completo — mídia até a conversão principal, taxa entre etapas.
//   3. Eficiência comercial e origem — quando há vendas.
//   4. Histórico — a conversão principal semana a semana.
//   5. Performance da mídia — os mesmos objetivos do relatório 1, menor peso.
//   6. Criativos que explicam a semana — só os destaques.
//   7. Vendas descritas no feedback — quando houver.
//
// Duas regras que não se negociam:
// - AUSÊNCIA NÃO É ZERO: métrica não informada não vira cartão, etapa nem conta.
// - Quando o funil cruza fontes (mídia × feedback, que inclui todos os canais),
//   a taxa é dita como proporção e o relatório avisa que é leitura agregada.

import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import { previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import type { MetaPost } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver } from "./campaignBlockKpis";
import { attributionOf, type InformedTotals } from "./conversionMode";
import { salesHeadline } from "./salesHeadline";
import { creativeHighlights, creativeRows, mediaTotals, money, num, objectiveSummaries } from "./adsInsights";
import {
  FOCUS_LABEL, costLadder, focusOf, followersNarrative, historyChart, journeyFor, resultKpis,
  type HistoryPoint,
} from "./conversionFocus";
import { fullDay, objectivePanelsView, shortDay } from "./adsReportPdf";
import {
  DataTable, FooterNote, HighlightCards, HistoryBars, InsightRow, KpiBand, ListBox, ObjectivePanels, PageHeader,
  SectionHead, StatStack, SummaryBox, TrapezoidFunnel, V,
  type InsightItem, type StatItem,
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
  conversoes: ConversionRow[];
  prevConversoes?: ConversionRow[];
  /** Totais relatados no comentário. Ausentes = não informados; as linhas de
   *  `conversoes` só completam o total quando existem. */
  receitaTotal?: number | null;
  vendasTotal?: number | null;
  agendamentosTotal?: number | null;
  /** Total de seguidores do perfil ao fim do período (snapshot, não o ganho). */
  seguidores?: number | null;
  /** Totais do período anterior deste cliente, da série em `task_metrics`. */
  prevTotals?: SalesPrevTotals | null;
  /** A série da conversão, semanas anteriores E a atual (ordem livre). */
  history?: HistoryPoint[] | null;
  generatedAt: Date;
};

export type SalesPrevTotals = {
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
  /** O período REAL da linha usada como base (uma semana sem relatório deixa
   *  buraco na série — a legenda diz com o que a comparação foi feita). */
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

const pct = (a: number, b: number) => `${formatAcquisitionValue((a / b) * 100, "decimal")}%`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v))}`;

function SalesReportDocument({
  clientName, period, config, campaignPosts, adPosts, prevCampaignPosts, conversoes, prevConversoes,
  receitaTotal, vendasTotal, agendamentosTotal, seguidores, prevTotals, history, generatedAt,
}: SalesReportInput) {
  // ---- o que foi informado (null = não informado, nunca 0) ----
  const temLinhas = conversoes.length > 0;
  const linhas = totalsOf(conversoes);
  const vendas = vendasTotal ?? (temLinhas ? linhas.vendas : null);
  const agendados = agendamentosTotal ?? (temLinhas ? linhas.agendamentos : null);
  const informed: InformedTotals = {
    vendas,
    agendamentos: agendados !== null && vendas !== null ? Math.max(agendados, vendas) : agendados,
    receita: receitaTotal ?? (temLinhas && linhas.receita > 0 ? linhas.receita : null),
    seguidores: seguidores ?? null,
  };
  const prevLinhas = prevConversoes?.length ? totalsOf(prevConversoes) : null;
  const prevInformed: InformedTotals | null = prevTotals || prevLinhas
    ? {
        vendas: prevTotals?.vendas ?? prevLinhas?.vendas ?? null,
        agendamentos: prevTotals?.agendamentos ?? prevLinhas?.agendamentos ?? null,
        receita: prevTotals?.receita ?? (prevLinhas && prevLinhas.receita > 0 ? prevLinhas.receita : null),
        seguidores: prevTotals?.seguidores ?? null,
      }
    : null;

  const focus = focusOf(informed);
  const media = mediaTotals(campaignPosts);
  const prevMedia = prevCampaignPosts.some((p) => p.source === "paid") ? mediaTotals(prevCampaignPosts) : null;

  // ---- série: a semana atual entra se ainda não estiver lá ----
  const series: HistoryPoint[] = [...(history ?? [])].sort((a, b) => a.periodTo.localeCompare(b.periodTo));
  if (!series.some((h) => h.periodTo === period.to)) series.push({ periodTo: period.to, ...informed });
  const idx = series.findIndex((h) => h.periodTo === period.to);
  const prevPoint = prevTotals?.seguidores != null ? { seguidores: prevTotals.seguidores } : idx > 0 ? series[idx - 1] : null;
  const followersGain = informed.seguidores !== null && prevPoint?.seguidores != null ? informed.seguidores - prevPoint.seguidores : null;
  const prevFollowersGain = idx >= 2 && series[idx - 1].seguidores != null && series[idx - 2].seguidores != null
    ? (series[idx - 1].seguidores as number) - (series[idx - 2].seguidores as number)
    : null;

  const comparedRange = prevTotals?.from && prevTotals?.to ? { from: prevTotals.from, to: prevTotals.to } : prevInformed ? previousPeriod(period) : null;
  const comparedWith = comparedRange ? `${shortDay(comparedRange.from)} a ${shortDay(comparedRange.to)}` : null;

  // ---- 1. faixa + leitura ----
  const kpis = resultKpis({ kind: focus, cur: informed, prev: prevInformed, media, prevMedia, followersGain, prevFollowersGain });
  const atribuicao = attributionOf(informed.vendas, conversoes);
  const spend = media.spend;

  let primary: InsightItem;
  const cards: InsightItem[] = [];
  if (focus === "vendas" || focus === "agendamentos") {
    const head = salesHeadline({
      receita: informed.receita, vendas: informed.vendas, agendamentos: informed.agendamentos, seguidoresGanho: followersGain,
      prev: prevInformed ? { receita: prevInformed.receita, vendas: prevInformed.vendas } : null,
    });
    const parts = [
      informed.agendamentos && informed.vendas !== null ? `${pct(informed.vendas, informed.agendamentos)} dos agendamentos viraram venda` : null,
      informed.receita !== null && informed.vendas ? `ticket médio de ${money(informed.receita / informed.vendas)}` : null,
      media.conversations !== null ? `${num(media.conversations)} conversas pela mídia` : null,
    ].filter(Boolean);
    primary = { title: "Leitura comercial", headline: head, body: parts.length ? `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()) : undefined };
    const target = focus === "vendas" ? informed.vendas : informed.agendamentos;
    if (spend && target) {
      cards.push({
        title: `Custo de mídia por ${focus === "vendas" ? "venda" : "agendamento"}`,
        headline: money(spend / target),
        body: `todo o investimento dividido por ${focus === "vendas" ? "todas as vendas relatadas" : "todos os agendamentos relatados"} — inclui outros canais`,
      });
    }
    // Seguidores já entram na faixa quando informados; o segundo cartão traz
    // o que ainda não apareceu: de onde vieram as vendas, ou o que ficou em aberto.
    if (atribuicao.coberturaPct !== null) {
      cards.push({ title: "Origem das vendas", headline: `${atribuicao.comOrigem} de ${atribuicao.informadas} com origem`, body: "descrita no feedback como fonte #1, #2 ou #3" });
    } else if (informed.agendamentos !== null && informed.vendas !== null && informed.agendamentos > informed.vendas) {
      cards.push({ title: "Agendamentos em aberto", headline: num(informed.agendamentos - informed.vendas), body: "agendados na semana que ainda não viraram venda" });
    } else if (followersGain !== null && kpis.every((k) => k.label !== "Seguidores novos")) {
      cards.push({ title: "Resultado adicional", headline: `${signed(followersGain)} seguidores`, body: `perfil com ${num(informed.seguidores)}` });
    }
  } else if (focus === "seguidores") {
    const n = followersNarrative(followersGain, prevFollowersGain, informed.seguidores, media.profileVisits);
    primary = { title: "Leitura da audiência", headline: n.headline, body: n.body };
    if (spend && followersGain && followersGain > 0) {
      cards.push({ title: "Custo por seguidor novo", headline: money(spend / followersGain), body: "investimento total dividido pelos seguidores ganhos — inclui quem chegou sem anúncio" });
    }
    // Visitas já estão na faixa e no funil; aqui entra o que ainda não foi dito —
    // quanto o perfil cresceu em proporção.
    if (informed.seguidores !== null && prevPoint?.seguidores) {
      const growth = ((informed.seguidores - prevPoint.seguidores) / prevPoint.seguidores) * 100;
      cards.push({
        title: "Crescimento do perfil",
        headline: `${growth >= 0 ? "+" : "−"}${formatAcquisitionValue(Math.abs(growth), "decimal")}%`,
        body: `de ${num(prevPoint.seguidores)} para ${num(informed.seguidores)} seguidores em uma semana`,
      });
    } else if (media.profileVisits !== null) {
      cards.push({ title: "Visitas ao perfil", headline: num(media.profileVisits), body: media.reach ? `${pct(media.profileVisits, media.reach)} de quem foi alcançado pela mídia` : "levadas pela mídia no período" });
    }
  } else {
    primary = {
      title: "Leitura da semana",
      headline: "Sem números comerciais informados nesta semana.",
      body: "O resultado comercial aparece quando o feedback da semana for respondido; abaixo, só a mídia.",
    };
    if (spend !== null) cards.push({ title: "Investimento", headline: money(spend), body: "no período" });
    if (media.conversations !== null) cards.push({ title: "Conversas", headline: num(media.conversations), body: "geradas pela mídia" });
  }

  const naoInformadas = [
    ...(informed.receita === null ? ["receita"] : []),
    ...(informed.vendas === null ? ["vendas"] : []),
    ...(informed.agendamentos === null ? ["agendamentos"] : []),
    ...(informed.seguidores === null ? ["seguidores"] : []),
  ];

  // ---- 2. funil + pilha ----
  const journey = journeyFor(focus, media, informed, followersGain);
  const ladder = costLadder(spend, media.conversations, informed);
  // A nota de fontes cita só as etapas que ESTE funil desenhou.
  const listPt = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`);
  const mediaStages = journey.stages.filter((s) => s.source === "midia").map((s) => s.label.toLowerCase());
  const feedbackStages = journey.stages.filter((s) => s.source === "feedback").map((s) => s.label.toLowerCase());
  const crossNote = `${listPt(mediaStages).replace(/^./, (c) => c.toUpperCase())} vêm da mídia; ${listPt(feedbackStages)} vêm do feedback e incluem todos os canais — as proporções entre essas etapas são indicativas.`;
  const stats: StatItem[] = [];
  if (focus === "vendas") {
    // Receita e ticket já estão na faixa; a pilha traz o que se tira deles.
    if (informed.receita !== null && spend) {
      stats.push({ label: "Receita por R$ 1 investido", value: money(informed.receita / spend), detail: "todas as vendas da semana sobre todo o investimento — não só o que veio de anúncio", soft: true });
    }
    // Sem seta: a Fraunces não tem o glifo "→" e ele sairia como um apóstrofo.
    if (ladder.length >= 2) {
      stats.push({ label: "Custo de mídia da conversa à venda", value: `de ${ladder[0].value} a ${ladder[ladder.length - 1].value}`, detail: `${ladder[0].label} e ${ladder[ladder.length - 1].label}, sobre o investimento total` });
    }
    if (informed.agendamentos !== null && informed.vendas !== null && informed.agendamentos > informed.vendas && atribuicao.coberturaPct !== null) {
      stats.push({ label: "Agendamentos em aberto", value: num(informed.agendamentos - informed.vendas), detail: "agendados na semana que ainda não viraram venda" });
    }
  } else if (focus === "seguidores") {
    if (informed.seguidores !== null) stats.push({ label: "Seguidores no perfil", value: num(informed.seguidores), detail: prevPoint?.seguidores != null ? `${num(prevPoint.seguidores)} na semana anterior` : "primeira semana registrada", soft: true });
    // Ganho e visitas já estão no funil ao lado — a pilha traz o que se tira deles.
    if (spend && media.profileVisits) stats.push({ label: "Custo por visita ao perfil", value: money(spend / media.profileVisits), detail: "investimento dividido pelas visitas que a mídia levou" });
    if (media.profileVisits !== null && media.reach) stats.push({ label: "A cada 1.000 alcançados", value: formatAcquisitionValue((media.profileVisits / media.reach) * 1000, "decimal"), detail: "visitaram o perfil — leitura agregada das campanhas" });
  } else {
    if (informed.agendamentos !== null) stats.push({ label: "Agendamentos", value: num(informed.agendamentos), detail: "informados no feedback", soft: true });
    if (spend !== null) stats.push({ label: "Investimento", value: money(spend), detail: "no período" });
    if (media.costPerConversation !== null) stats.push({ label: "Custo por conversa", value: money(media.costPerConversation), detail: "investimento dividido pelas conversas" });
  }

  // ---- 3. eficiência + origem ----
  const showEfficiency = focus === "vendas" && (ladder.length > 0 || (informed.agendamentos && informed.vendas !== null));
  const efficiencyHeadline = informed.agendamentos && informed.vendas !== null
    ? pct(informed.vendas, informed.agendamentos)
    : informed.receita !== null && informed.vendas ? money(informed.receita / informed.vendas) : num(informed.vendas);
  const efficiencyCaption = informed.agendamentos && informed.vendas !== null
    ? "dos agendamentos viraram venda"
    : informed.receita !== null && informed.vendas ? "de ticket médio" : "vendas na semana";
  const originRows = [
    ...Object.entries(atribuicao.porFonte).map(([fonte, t]) => ({
      left: `Fonte #${fonte}`,
      right: `${t!.vendas} venda${t!.vendas > 1 ? "s" : ""}${t!.receita !== null ? ` · ${money(t!.receita)}` : ""}`,
    })),
    ...(atribuicao.informadas !== null && atribuicao.informadas > atribuicao.comOrigem
      ? [{ left: "Sem origem descrita", right: `${atribuicao.informadas - atribuicao.comOrigem} venda${atribuicao.informadas - atribuicao.comOrigem > 1 ? "s" : ""}` }]
      : []),
  ];
  const extraRows = [
    ...(followersGain !== null ? [{ left: "Seguidores novos", right: signed(followersGain) }] : []),
    ...(informed.agendamentos !== null && informed.vendas !== null && informed.agendamentos > informed.vendas
      ? [{ left: "Agendamentos ainda sem venda", right: num(informed.agendamentos - informed.vendas) }]
      : []),
    ...(media.conversations !== null ? [{ left: "Conversas pela mídia", right: num(media.conversations) }] : []),
  ];

  // ---- 4. histórico ----
  const chart = historyChart(focus, series);
  const weekRows = series.slice(-4).map((h, i, arr) => {
    if (focus === "seguidores") {
      const before = i > 0 ? arr[i - 1].seguidores : null;
      return { left: shortDay(h.periodTo), right: h.seguidores === null ? "não informado" : `${num(h.seguidores)}${before !== null && before !== undefined ? ` (${signed(h.seguidores - before)})` : ""}` };
    }
    const bits = [h.vendas !== null ? `${num(h.vendas)} vendas` : null, h.agendamentos !== null ? `${num(h.agendamentos)} agend.` : null, h.receita !== null ? money(h.receita) : null].filter(Boolean);
    return { left: shortDay(h.periodTo), right: bits.length ? bits.join(" · ") : "não informado" };
  });

  // ---- 5/6. mídia com menos peso ----
  const { postBlock } = blockResolver(config);
  const objectives = objectiveSummaries(campaignPosts, prevCampaignPosts, postBlock);
  const { rows: creatives } = creativeRows(adPosts);
  const highlights = creativeHighlights(creatives, media.conversations);

  // ---- 7. detalhe ----
  const detalhe = [...conversoes].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, 10);

  return (
    <Document>
      <Page size="A4" style={V.page} wrap>
        <PageHeader
          eyebrow={clientName}
          title="Relatório de resultados"
          subtitle={`${fullDay(period.from)} a ${fullDay(period.to)} · mídia + conversão · foco em ${FOCUS_LABEL[focus].toLowerCase()} · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`}
          pill="Relatório 2"
        />

        <View style={V.section}>
          <SectionHead title="Resultado da semana" micro={comparedWith ? `comparado com ${comparedWith}` : "primeira semana da série"} />
          {kpis.length ? <KpiBand items={kpis.map((k) => ({ label: k.label, value: k.value, delta: { text: k.delta.text, tone: k.delta.tone } }))} /> : null}
          <InsightRow primary={primary} cards={cards.slice(0, 2)} />
          {naoInformadas.length && focus !== "midia" ? (
            <Text style={V.note}>Não informado no feedback da semana: {naoInformadas.join(", ")}.</Text>
          ) : null}
        </View>

        {journey.stages.length >= 2 ? (
          <View style={V.section} wrap={false}>
            <SectionHead title="Funil completo" micro={journey.crossesSources ? "jornada agregada — mídia + feedback" : "leitura agregada das campanhas"} />
            <View style={V.funnelWrap}>
              <View style={V.funnelCol}>
                <TrapezoidFunnel stages={journey.stages.map((s) => ({ label: s.label, value: num(s.value) }))} gaps={journey.gaps} />
              </View>
              {stats.length ? <StatStack items={stats.slice(0, 3)} /> : null}
            </View>
            {journey.crossesSources ? (
              <Text style={V.note}>{crossNote}</Text>
            ) : null}
          </View>
        ) : null}

        {showEfficiency ? (
          <View style={[V.section, V.split]} wrap={false}>
            <SummaryBox
              label="Eficiência comercial"
              headline={efficiencyHeadline}
              caption={efficiencyCaption}
              money={ladder.map((s) => ({ value: s.value, label: s.label }))}
            />
            {originRows.length ? (
              <ListBox label="Resultado por origem" rows={originRows} note="Origem e receita por fonte aparecem só quando informadas no feedback — a receita total nunca é distribuída entre fontes." />
            ) : extraRows.length ? (
              <ListBox label="Resultado adicional" rows={extraRows} />
            ) : null}
          </View>
        ) : null}

        <View style={V.section} wrap={false}>
          <SectionHead title="Histórico" micro={chart ? chart.title.toLowerCase() : "começa na segunda semana registrada"} />
          {chart ? (
            <View style={V.split}>
              <View style={[V.box, { flex: 1.25, alignItems: "center" }]}>
                <HistoryBars periods={chart.periods} series={chart.series.map((s) => ({ label: s.label, values: s.values }))} width={290} />
              </View>
              <ListBox label="Semana a semana" rows={weekRows} flex={0.75} />
            </View>
          ) : (
            <Text style={V.note}>
              {focus === "midia"
                ? "Sem conversão informada para acompanhar semana a semana."
                : `Esta é a primeira semana com ${FOCUS_LABEL[focus].toLowerCase()} registrados — o histórico aparece a partir da próxima.`}
            </Text>
          )}
        </View>

        {/* Com funil, eficiência e histórico a página 1 fecha o resultado
            comercial; a mídia começa numa página própria em vez de pular sozinha
            e deixar um vão no pé da primeira. */}
        {objectives.length ? (
          <View style={V.section} wrap={false} break={Boolean(chart && showEfficiency)}>
            <SectionHead title="Performance da mídia" micro="mesmos dados do relatório 1, com menos peso" />
            <ObjectivePanels panels={objectivePanelsView(objectives)} />
          </View>
        ) : null}

        {highlights.length ? (
          <View style={V.section} wrap={false}>
            <SectionHead title="Criativos que explicam a semana" micro="destaques por regra" />
            <HighlightCards items={highlights} />
          </View>
        ) : null}

        {detalhe.length ? (
          <View style={V.section}>
            <SectionHead title="Vendas descritas no feedback" micro={informed.vendas !== null && detalhe.length < informed.vendas ? `${detalhe.length} de ${informed.vendas} descritas uma a uma` : undefined} />
            <DataTable
              columns={[
                { key: "servico", label: "Serviço", flex: 2.4 },
                { key: "fonte", label: "Origem" },
                { key: "status", label: "Situação" },
                { key: "valor", label: "Valor", align: "right" },
              ]}
              rows={detalhe.map((row) => ({
                cells: {
                  servico: row.servico ?? "não descrito",
                  fonte: row.fonte ? `#${row.fonte}` : "sem origem",
                  status: row.status === "fechado" ? "Fechada" : row.status === "agendado" ? "Agendada" : "não informada",
                  valor: row.valor === null ? "não informado" : money(row.valor),
                },
              }))}
            />
          </View>
        ) : null}

        <FooterNote
          left="North · relatório gerado automaticamente"
          right="Relatório 2 · origem, receita por fonte e outros detalhes comerciais só aparecem quando informados no feedback"
        />
      </Page>
    </Document>
  );
}

export async function renderSalesReportPdf(input: SalesReportInput): Promise<Buffer> {
  return renderToBuffer(<SalesReportDocument {...input} />);
}
