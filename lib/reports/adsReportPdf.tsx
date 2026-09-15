// PDF do "Relatório de anúncios" (Automação 1 — relatorio_trafego_semanal).
//
// Pergunta que responde: COMO A MÍDIA PERFORMOU NESTA SEMANA? Determinístico —
// só dados da API, nenhuma IA.
//
// Ordem de leitura (modelo v2):
//   1. Performance da semana — cinco números da mídia inteira e a leitura em
//      uma frase. É o que precisa caber nos primeiros segundos.
//   2. Funil de aquisição — alcance → cliques → conversas (ou visitas ao perfil,
//      para quem quase não recebe mensagem), com a taxa ENTRE as etapas.
//   3. Performance por objetivo — os objetivos lado a lado, para comparar na
//      horizontal em vez de ler doze cartões empilhados.
//   4. Criativos — três destaques calculados por regra, depois a tabela.
//
// Toda a leitura (totais, criticidade, destaques, frase) vem de adsInsights.ts;
// este arquivo só decide onde cada coisa aparece. Métrica técnica (CPC, CPE)
// só aparece quando é crítica, e sempre com a frase que a explica.

import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import { previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { MetaPost } from "@/lib/windsor";
import { registerReportFonts } from "./reportFonts";
import { blockResolver } from "./campaignBlockKpis";
import {
  OUTCOME_WORDS, READING_LABEL, attentionCard, creativeHighlights, creativeRows, deltaOf, mediaNarrative, mediaOutcome,
  mediaTotals, money, num, objectiveSummaries, outcomeCost, outcomeValue,
  type Direction, type ObjectiveSummary,
} from "./adsInsights";
import { journeyFor } from "./conversionFocus";
import {
  DataTable, FooterNote, HighlightCards, InsightRow, KpiBand, ObjectivePanels, PageHeader, SectionHead, StatStack, TrapezoidFunnel, V,
  type BandItem, type InsightItem, type PanelView, type StatItem,
} from "./reportBlocks";

registerReportFonts();

export type AdsReportInput = {
  clientName: string;
  period: Period;
  cadenceLabel: string;
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  // Linhas em nível de anúncio (só na conexão direta com a Meta) — a tabela de
  // criativos sai daqui. Vazio = conta sem detalhe por criativo.
  adPosts: MetaPost[];
  generatedAt: Date;
};

export const fullDay = (iso: string) => iso.split("-").reverse().join("/");
export const shortDay = (iso: string) => iso.slice(5).split("-").reverse().join("/");
const share = (v: number | null) => (v === null ? "—" : `${formatAcquisitionValue(v, "decimal")}%`);
const dlt = (c: number | null, p: number | null, dir: Direction) => {
  const d = deltaOf(c, p, dir);
  return { text: d.text, tone: d.tone };
};

/** Os objetivos lado a lado — compartilhado com o relatório de resultados, que
 *  mostra a mesma mídia com menos peso. Até dois painéis: com mais objetivos, os
 *  de maior verba, e uma nota diz quantos ficaram de fora. */
export function objectivePanelsView(objectives: ObjectiveSummary[]): PanelView[] {
  return objectives.slice(0, 2).map((o) => ({
    title: o.label,
    meta: `${money(o.spend)} investidos`,
    slots: o.slots.map((s) => ({ label: s.label, value: s.value, delta: { text: s.delta.text, tone: s.delta.tone }, note: s.note })),
  }));
}

function AdsReportDocument({ clientName, period, config, posts, prevPosts, adPosts, generatedAt }: AdsReportInput) {
  const hidden = new Set(config.acquisition.hiddenSections);
  const { postBlock } = blockResolver(config);

  const cur = mediaTotals(posts);
  const prev = prevPosts.some((p) => p.source === "paid") ? mediaTotals(prevPosts) : null;
  const prevRange = previousPeriod(period);
  const comparedWith = prev ? `${shortDay(prevRange.from)} a ${shortDay(prevRange.to)}` : null;

  const outcome = mediaOutcome(cur);
  const W = OUTCOME_WORDS[outcome];
  const value = outcomeValue(cur, outcome);
  const cost = outcomeCost(cur, outcome);
  const objectives = objectiveSummaries(posts, prevPosts, postBlock);
  const narrative = mediaNarrative(cur, prev, comparedWith, outcome);
  const attention = attentionCard(objectives);
  const { rows: creatives, hiddenNoise } = creativeRows(adPosts);
  const highlights = creativeHighlights(creatives, cur.conversations);
  const CREATIVE_ROWS = 6;
  // O que ficou fora da tabela vai no cabeçalho da seção: uma linha solta
  // depois da tabela chegou a abrir uma página 2 só para ela.
  const creativeMicro = [
    "leitura por regra",
    creatives.length > CREATIVE_ROWS ? `+${creatives.length - CREATIVE_ROWS} com menos investimento` : null,
    hiddenNoise > 0 ? `${hiddenNoise} com gasto irrisório omitido${hiddenNoise > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ");

  // 1. Faixa — o desfecho da mídia ganha o destaque, investimento sem cor.
  const band: BandItem[] = [
    { label: "Investimento", value: money(cur.spend), delta: dlt(cur.spend, prev?.spend ?? null, "neutral") },
    { label: "Alcance", value: num(cur.reach), delta: dlt(cur.reach, prev?.reach ?? null, "higher_is_better") },
    { label: "Cliques", value: num(cur.clicks), delta: dlt(cur.clicks, prev?.clicks ?? null, "higher_is_better") },
    { label: W.Plural, value: num(value), delta: dlt(value, prev ? outcomeValue(prev, outcome) : null, "higher_is_better") },
    {
      label: `Custo por ${W.unit}`,
      value: cost === null ? "—" : money(cost),
      delta: cost === null ? { text: `sem ${W.plural} no período`, tone: "neutral" } : dlt(cost, prev ? outcomeCost(prev, outcome) : null, "lower_is_better"),
    },
  ];

  // Leitura: com dois ou mais objetivos, onde foi a verba e de onde veio o
  // resultado; com um objetivo só, esses dois cartões seriam "100%" e cedem o
  // lugar ao criativo e ao ponto de atenção.
  const top = objectives.slice(0, 2);
  const byOutcome = [...objectives].sort((a, b) => (b.conversations ?? 0) - (a.conversations ?? 0))[0];
  const insightCards: InsightItem[] = objectives.length >= 2
    ? [
        {
          title: "Distribuição da verba",
          headline: top.map((o) => `${share(o.spendShare)} ${o.label}`).join(" · "),
          body: `${top[0].label} ${(top[0].spendShare ?? 0) >= 50 ? "concentrou a maior parte" : "recebeu a maior fatia"} do investimento.`,
        },
        {
          title: "De onde vieram as conversas",
          headline: top.map((o) => `${share(o.conversationShare)} ${o.label}`).join(" · "),
          body: (cur.conversations ?? 0) > 0 && byOutcome ? `${byOutcome.label} trouxe a maior parte das conversas.` : "Nenhum objetivo gerou conversa na semana.",
        },
      ]
    : [
        ...(highlights[0] ? [{ title: "Criativo em destaque", headline: highlights[0].name, body: `${highlights[0].value} · ${highlights[0].detail}` }] : []),
        ...(attention ? [{ title: attention.label, headline: attention.value, body: attention.detail }] : []),
      ];

  // 2. Funil + pilha lateral.
  const journey = journeyFor(outcome === "conversas" ? "midia" : "seguidores", cur, { vendas: null, agendamentos: null, receita: null, seguidores: null }, null);
  const per1000 = value !== null && cur.reach ? (value / cur.reach) * 1000 : null;
  const stats: StatItem[] = [
    { label: `Custo por ${W.unit}`, value: cost === null ? "—" : money(cost), detail: `investimento dividido pelas ${W.plural} do período`, soft: true },
    ...(per1000 !== null
      ? [{ label: "A cada 1.000 alcançados", value: formatAcquisitionValue(per1000, "decimal"), detail: `${outcome === "conversas" ? "conversaram" : "visitaram o perfil"} — leitura agregada das campanhas` }]
      : []),
    ...(objectives.length >= 2 && attention ? [{ label: attention.label, value: attention.value, detail: attention.detail, tone: attention.tone }] : []),
    ...(objectives.length < 2 && highlights[1] ? [{ label: highlights[1].tag.replace("★ ", ""), value: highlights[1].value, detail: `${highlights[1].name} · ${highlights[1].detail}` }] : []),
  ];

  return (
    <Document>
      <Page size="A4" style={V.page} wrap>
        <PageHeader
          eyebrow={clientName}
          title="Relatório de anúncios"
          subtitle={`${fullDay(period.from)} a ${fullDay(period.to)} · mídia, campanhas e criativos · gerado em ${generatedAt.toLocaleDateString("pt-BR")}`}
          pill="Relatório 1"
        />

        <View style={V.section}>
          <SectionHead title="Performance da semana" micro={comparedWith ? `comparado com ${comparedWith}` : "primeira semana registrada"} />
          <KpiBand items={band} heroIndex={3} />
          <InsightRow primary={{ title: "Leitura da semana", headline: narrative.headline, body: narrative.body }} cards={insightCards} />
        </View>

        {!hidden.has("funnel") && journey.stages.length >= 2 ? (
          <View style={V.section} wrap={false}>
            <SectionHead title="Funil de aquisição" micro="leitura agregada de todas as campanhas" />
            <View style={V.funnelWrap}>
              <View style={V.funnelCol}>
                <TrapezoidFunnel stages={journey.stages.map((s) => ({ label: s.label, value: num(s.value) }))} gaps={journey.gaps} />
              </View>
              <StatStack items={stats.slice(0, 3)} />
            </View>
          </View>
        ) : null}

        {objectives.length ? (
          <View style={V.section} wrap={false}>
            <SectionHead title="Performance por objetivo" micro="comparação direta" />
            <ObjectivePanels panels={objectivePanelsView(objectives)} />
            {objectives.length > 2 ? (
              <Text style={V.note}>+{objectives.length - 2} objetivo{objectives.length - 2 > 1 ? "s" : ""} com menos verba no período.</Text>
            ) : null}
            {objectives.some((o) => o.efficiency?.critical) ? (
              <Text style={V.note}>Custos unitários (por clique, por engajamento) só aparecem quando pioraram de forma relevante — nas outras semanas o espaço mostra a parte da verba.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={V.section}>
          <SectionHead title="Criativos em destaque" micro={creativeMicro} />
          {creatives.length ? (
            <>
              <HighlightCards items={highlights} />
              <DataTable
                columns={[
                  { key: "leitura", label: "Leitura", flex: 1.25 },
                  { key: "criativo", label: "Criativo", flex: 2.6 },
                  { key: "alcance", label: "Alcance", align: "right" },
                  { key: "cliques", label: "Cliques", align: "right" },
                  { key: "conversas", label: "Conversas", align: "right" },
                  { key: "invest", label: "Invest.", align: "right" },
                ]}
                rows={creatives.slice(0, CREATIVE_ROWS).map((r) => ({
                  cells: {
                    leitura: READING_LABEL[r.reading],
                    criativo: r.name,
                    alcance: num(r.reach),
                    cliques: num(r.clicks),
                    conversas: num(r.conversations),
                    invest: money(r.spend),
                  },
                  tone: { leitura: r.reading === "revisar" ? "bad" : r.reading === "estavel" ? "neutral" : "good" },
                }))}
              />
            </>
          ) : (
            <Text style={V.note}>Sem detalhe por criativo nesta conta.</Text>
          )}
        </View>

        <FooterNote left="North · relatório gerado automaticamente" right="Relatório 1 · mídia, campanhas e criativos" />
      </Page>
    </Document>
  );
}

export async function renderAdsReportPdf(input: AdsReportInput): Promise<Buffer> {
  return renderToBuffer(<AdsReportDocument {...input} />);
}
