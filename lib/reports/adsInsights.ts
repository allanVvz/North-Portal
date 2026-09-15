// A leitura do relatório de anúncios, calculada antes de desenhar — puro, sem
// PDF e sem banco. Os dois relatórios consomem isto: o de anúncios como assunto
// principal, o de resultados como contexto da conversão.
//
// Plano: docs/reporting/adaptive-report-plan.md. Regras de produto que moram
// aqui, e não no layout:
//
// 1. A frase começa pelo resultado mais JUSTO. Queda de volume com ganho de
//    eficiência abre pela eficiência ("com 21% menos investimento, manteve 23
//    conversas a um custo 10% menor"), não pela perda.
// 2. Métrica técnica (CPC, CPE) só vira destaque quando é crítica E o próprio
//    resultado do objetivo piorou. Com resultado saudável ela fica na tabela.
// 3. No máximo UM alerta por relatório.
// 4. Investimento é neutro. Nenhuma frase afirma causa.

import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import { recomputeRatios, sumMetricsInto } from "@/app/admin/performance/insights";
import { CAMPAIGN_BLOCK_LABEL, type CampaignBlock } from "@/lib/performanceTemplates";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";

export type Metrics = Partial<Record<MetaPostMetricKey, number>>;
export type Tone = "good" | "bad" | "neutral";
export type Direction = "higher_is_better" | "lower_is_better" | "neutral";

/** Abaixo disto a variação não ganha cor — é oscilação, não sinal. */
const TONE_THRESHOLD = 5;
/** A partir disto um custo unitário é crítico. */
export const CRITICAL_COST_INCREASE = 30;

// ---- formatação -----------------------------------------------------------------

export const money = (v: number | null) => formatAcquisitionValue(v, "money");
export const num = (v: number | null) => formatAcquisitionValue(v);
export const pctText = (v: number) => `${formatAcquisitionValue(Math.abs(v), "decimal")}%`;
/** Percentual redondo para frases ("21%"), sem sinal. */
export const pctRound = (v: number) => `${Math.round(Math.abs(v))}%`;
export const signed = (v: number) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v))}`;

export type Delta = { pct: number | null; tone: Tone; text: string };

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function deltaOf(current: number | null, previous: number | null, direction: Direction): Delta {
  const pct = pctChange(current, previous);
  if (pct === null) return { pct: null, tone: "neutral", text: "sem semana anterior" };
  const text = `${pct >= 0 ? "↑" : "↓"} ${pctText(pct)}`;
  if (direction === "neutral" || Math.abs(pct) < TONE_THRESHOLD) return { pct, tone: "neutral", text };
  const better = direction === "higher_is_better" ? pct > 0 : pct < 0;
  return { pct, tone: better ? "good" : "bad", text };
}

// ---- totais -----------------------------------------------------------------------

export type MediaTotals = {
  spend: number | null;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  ctr: number | null;
  landingViews: number | null;
  profileVisits: number | null;
  conversations: number | null;
  engagement: number | null;
  costPerConversation: number | null;
};

function sumKey(posts: MetaPost[], key: MetaPostMetricKey): number | null {
  let total = 0;
  let present = false;
  for (const p of posts) {
    const v = p.metrics[key];
    if (v === undefined) continue;
    present = true;
    total += v;
  }
  return present ? total : null;
}

/** Soma das campanhas pagas. Alcance somado entre campanhas pode contar a mesma
 *  pessoa mais de uma vez — a nota de rodapé do relatório diz isso uma vez. */
export function mediaTotals(posts: MetaPost[]): MediaTotals {
  const paid = posts.filter((p) => p.source === "paid");
  const spend = sumKey(paid, "custo");
  const impressions = sumKey(paid, "impressoes");
  const linkClicks = sumKey(paid, "cliquesLink");
  const clicks = sumKey(paid, "cliques") ?? linkClicks;
  const conversations = sumKey(paid, "contatos") ?? (paid.length ? 0 : null);
  return {
    spend,
    reach: sumKey(paid, "alcance"),
    impressions,
    clicks,
    linkClicks,
    ctr: impressions && clicks !== null ? (clicks / impressions) * 100 : null,
    landingViews: sumKey(paid, "landingPageViews"),
    profileVisits: sumKey(paid, "profileVisits"),
    conversations,
    engagement: sumKey(paid, "engajamento"),
    costPerConversation: spend !== null && conversations ? spend / conversations : null,
  };
}

// ---- desfecho da mídia ------------------------------------------------------------------

/** O desfecho que a mídia entrega para ESTE cliente: conversa quando existe
 *  volume; visita ao perfil para quem quase não recebe mensagem. */
export type MediaOutcome = "conversas" | "visitas";

export const OUTCOME_WORDS: Record<MediaOutcome, { plural: string; Plural: string; unit: string; verb: string }> = {
  conversas: { plural: "conversas", Plural: "Conversas", unit: "conversa", verb: "conversaram" },
  visitas: { plural: "visitas ao perfil", Plural: "Visitas ao perfil", unit: "visita", verb: "visitaram o perfil" },
};

export function mediaOutcome(t: MediaTotals): MediaOutcome {
  return (t.conversations ?? 0) >= 3 || !t.profileVisits ? "conversas" : "visitas";
}

export function outcomeValue(t: MediaTotals, o: MediaOutcome): number | null {
  return o === "conversas" ? t.conversations : t.profileVisits;
}

export function outcomeCost(t: MediaTotals, o: MediaOutcome): number | null {
  const v = outcomeValue(t, o);
  return t.spend !== null && v ? t.spend / v : null;
}

// ---- objetivos ---------------------------------------------------------------------------

/** O custo unitário técnico de cada objetivo e como dizê-lo em português. */
const TECHNICAL: Record<CampaignBlock, { metric: MetaPostMetricKey; label: string; unit: string }> = {
  trafego_site: { metric: "cliquesLink", label: "CPC", unit: "clique no site" },
  trafego_perfil: { metric: "profileVisits", label: "Custo por visita", unit: "visita ao perfil" },
  mensagens: { metric: "contatos", label: "Custo por conversa", unit: "conversa" },
  engajamento: { metric: "engajamento", label: "CPE", unit: "engajamento" },
  outro: { metric: "cliques", label: "CPC", unit: "clique" },
};

export type TechnicalSignal = { label: string; cost: number; delta: Delta; critical: boolean; explanation: string };

export type ObjectiveRow = {
  block: CampaignBlock;
  label: string;
  spend: number;
  spendShare: number | null;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  visits: number | null;
  conversations: number | null;
  result: number | null;
  resultShare: number | null;
  costPerResult: number | null;
  resultDelta: Delta;
  costDelta: Delta;
  technical: TechnicalSignal | null;
};

function aggregate(posts: MetaPost[], blockOf: (p: MetaPost) => CampaignBlock): Map<CampaignBlock, Metrics> {
  const out = new Map<CampaignBlock, Metrics>();
  for (const p of posts) {
    if (p.source !== "paid") continue;
    const block = blockOf(p);
    const m = out.get(block) ?? {};
    sumMetricsInto(m, p.metrics);
    out.set(block, m);
  }
  for (const m of out.values()) recomputeRatios(m);
  return out;
}

export function technicalOf(block: CampaignBlock, cur: Metrics, prev: Metrics | undefined): TechnicalSignal | null {
  const def = TECHNICAL[block];
  const volume = cur[def.metric];
  if (!cur.custo || !volume) return null;
  const cost = cur.custo / volume;
  const prevVolume = prev?.[def.metric];
  const prevCost = prev?.custo && prevVolume ? prev.custo / prevVolume : null;
  const delta = deltaOf(cost, prevCost, "lower_is_better");
  const critical = delta.pct !== null && delta.pct >= CRITICAL_COST_INCREASE;
  const explanation = delta.pct === null
    ? `Cada ${def.unit} custou ${money(cost)}.`
    : `Cada ${def.unit} custou ${money(cost)}, ${pctRound(delta.pct)} ${delta.pct >= 0 ? "mais caro" : "mais barato"} que na semana anterior.`;
  return { label: def.label, cost, delta, critical, explanation };
}

const visitsOf = (block: CampaignBlock, m: Metrics | undefined): number | null => {
  if (!m) return null;
  if (block === "trafego_site" && m.landingPageViews !== undefined) return m.landingPageViews;
  return m.profileVisits ?? null;
};

export function objectiveRows(
  posts: MetaPost[],
  prevPosts: MetaPost[],
  blockOf: (p: MetaPost) => CampaignBlock,
  outcome: MediaOutcome,
): ObjectiveRow[] {
  const cur = aggregate(posts, blockOf);
  const prev = aggregate(prevPosts, blockOf);
  // Quando o desfecho é visita ao perfil, "visitas" é visita ao perfil em todo
  // objetivo — inclusive no de tráfego para o site, que antes mostrava a visita à
  // página (3) ao lado das 562 visitas ao perfil da faixa de números.
  const visitsFor = (block: CampaignBlock, m: Metrics | undefined) =>
    !m ? null : outcome === "visitas" ? m.profileVisits ?? null : visitsOf(block, m);
  const resultOf = (block: CampaignBlock, m: Metrics | undefined) =>
    !m ? null : outcome === "conversas" ? m.contatos ?? 0 : visitsFor(block, m);
  const totalSpend = [...cur.values()].reduce((s, m) => s + (m.custo ?? 0), 0);
  const totalResult = [...cur.entries()].reduce((s, [b, m]) => s + (resultOf(b, m) ?? 0), 0);

  return [...cur.entries()]
    .map(([block, m]) => {
      const p = prev.get(block);
      const result = resultOf(block, m);
      const prevResult = resultOf(block, p);
      const costPerResult = m.custo && result ? m.custo / result : null;
      const prevCost = p?.custo && prevResult ? p.custo / prevResult : null;
      const clicks = m.cliques ?? m.cliquesLink ?? null;
      return {
        block,
        label: CAMPAIGN_BLOCK_LABEL[block],
        spend: m.custo ?? 0,
        spendShare: totalSpend > 0 ? ((m.custo ?? 0) / totalSpend) * 100 : null,
        reach: m.alcance ?? null,
        impressions: m.impressoes ?? null,
        clicks,
        ctr: m.impressoes && clicks !== null ? (clicks / m.impressoes) * 100 : null,
        visits: visitsFor(block, m),
        conversations: m.contatos ?? null,
        result,
        resultShare: totalResult > 0 && result !== null ? (result / totalResult) * 100 : null,
        costPerResult,
        resultDelta: deltaOf(result, prevResult, "higher_is_better"),
        costDelta: deltaOf(costPerResult, prevCost, "lower_is_better"),
        technical: technicalOf(block, m, p),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

/** Objetivo que mais dominou a verba — decide se "cliques" do funil é clique no site. */
export function dominantBlock(objectives: ObjectiveRow[]): CampaignBlock | null {
  return objectives[0]?.block ?? null;
}

// ---- funil -------------------------------------------------------------------------------

export type FunnelStage = { key: string; label: string; value: number; source: "midia" | "feedback"; base?: boolean };

/** Etapas da mídia até o desfecho: alcance → cliques → conversas, ou alcance →
 *  visitas ao perfil. Os cliques são os MESMOS da faixa de números (nunca o
 *  clique no site de um lado e o total do outro), e visita ao site não entra entre
 *  cliques e conversas: a conversa não sai do site, e a taxa entre as duas seria
 *  falsa. Etapa sem dado real é pulada, nunca estimada. */
export function mediaFunnel(t: MediaTotals, outcome: MediaOutcome): FunnelStage[] {
  const out: FunnelStage[] = [];
  if (t.reach) out.push({ key: "alcance", label: "Alcance", value: t.reach, source: "midia" });
  if (outcome === "visitas") {
    if (t.profileVisits) out.push({ key: "visitas", label: "Visitas ao perfil", value: t.profileVisits, source: "midia" });
    return out;
  }
  if (t.clicks) out.push({ key: "cliques", label: "Cliques", value: t.clicks, source: "midia" });
  if (t.conversations !== null) out.push({ key: "conversas", label: "Conversas", value: t.conversations, source: "midia" });
  return out;
}

/** Taxa entre etapas: só na mesma fonte e só quando a etapa seguinte é menor.
 *  Entre mídia e feedback não há taxa — a limitação vai uma vez no rodapé. */
export function stageGap(from: FunnelStage, to: FunnelStage): string {
  if (from.base || to.base || from.source !== to.source || from.value <= 0 || to.value > from.value) return "";
  const rate = pctText((to.value / from.value) * 100);
  switch (to.key) {
    case "cliques": return `${rate} clicaram`;
    case "visitas": return `${rate} visitaram`;
    case "conversas": return `${rate} conversaram`;
    case "vendas": return `${rate} viraram venda`;
    default: return "";
  }
}

/** Largura de cada trapézio em escala logarítmica entre `min` e 100%: proporcional
 *  e legível (23 não some ao lado de 16.429). Nunca aumenta de uma etapa para a
 *  seguinte — o número continua real, a forma continua de funil. */
export function funnelWidths(values: number[], min = 0.36): number[] {
  if (!values.length) return [];
  const logs = values.map((v) => Math.log10(Math.max(1, v)));
  const hi = Math.max(...logs);
  const lo = Math.min(...logs);
  const out: number[] = [];
  values.forEach((_, i) => {
    const raw = hi === lo ? 1 - (i * (1 - min)) / Math.max(1, values.length - 1) : min + ((1 - min) * (logs[i] - lo)) / (hi - lo);
    out.push(i === 0 ? Math.max(raw, 0.94) : Math.min(raw, out[i - 1] - 0.04 > min ? out[i - 1] - 0.04 : out[i - 1]));
  });
  return out.map((w) => Math.max(min, Math.min(1, w)));
}

// ---- criativos ---------------------------------------------------------------------------

export type CreativeRow = {
  adId: string;
  creativeId: string | null;
  name: string;
  campaignName: string;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  conversations: number;
  visits: number | null;
  frequency: number | null;
  /** Resultado do criativo no desfecho da conta (conversas, ou visitas/cliques). */
  result: number;
  resultUnit: string;
  costPerResult: number | null;
  spendShare: number;
  resultShare: number | null;
};

const NOISE_SPEND = 2;
const NOISE_IMPRESSIONS = 100;

export function creativeRows(adPosts: MetaPost[], outcome: MediaOutcome): { rows: CreativeRow[]; hiddenNoise: number } {
  const byId = new Map<string, { base: MetaPost; metrics: Metrics }>();
  for (const p of adPosts) {
    if (!p.adId) continue;
    const entry = byId.get(p.adId) ?? { base: p, metrics: {} };
    sumMetricsInto(entry.metrics, p.metrics);
    byId.set(p.adId, entry);
  }
  const all = [...byId.values()].map(({ base, metrics: m }) => {
    const clicks = m.cliques ?? m.cliquesLink ?? 0;
    const impressions = m.impressoes ?? 0;
    const visits = m.profileVisits ?? null;
    const useVisits = outcome === "visitas";
    const result = outcome === "conversas" ? m.contatos ?? 0 : visits && visits > 0 ? visits : clicks;
    return {
      adId: base.adId as string,
      creativeId: base.creativeId ?? null,
      name: base.adName || base.caption || (base.adId as string),
      campaignName: base.campaignName ?? "",
      thumbnailUrl: base.thumbnailUrl ?? null,
      spend: m.custo ?? 0,
      impressions,
      reach: m.alcance ?? 0,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      conversations: m.contatos ?? 0,
      visits,
      frequency: m.alcance ? impressions / m.alcance : null,
      result,
      resultUnit: outcome === "conversas" ? "conversa" : useVisits && visits && visits > 0 ? "visita" : "clique",
      costPerResult: result > 0 ? (m.custo ?? 0) / result : null,
      spendShare: 0,
      resultShare: null as number | null,
    };
  });
  const rows = all.filter((r) => r.spend >= NOISE_SPEND || r.impressions >= NOISE_IMPRESSIONS);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalResult = rows.reduce((s, r) => s + r.result, 0);
  for (const r of rows) {
    r.spendShare = totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0;
    r.resultShare = totalResult > 0 ? (r.result / totalResult) * 100 : null;
  }
  rows.sort((a, b) => b.spend - a.spend);
  return { rows, hiddenNoise: all.length - rows.length };
}

export type BadgeKey =
  | "mais_conversas" | "mais_cliques" | "melhor_ctr" | "maior_investimento" | "maior_eficiencia"
  | "trafego_sem_conversao" | "atencao_sem_resposta" | "saturacao" | "explica_mudanca";

export type Badge = { key: BadgeKey; label: string; tone: Tone; detail: string };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const plural = (n: number, unit: string) => `${num(n)} ${n === 1 ? unit : `${unit}s`}`;

/** Destaques por criativo, do catálogo do plano. Cada destaque vai para no
 *  máximo um criativo; cada criativo recebe no máximo dois. "Estável" não existe. */
export function creativeBadges(rows: CreativeRow[], outcome: MediaOutcome, prevRows: CreativeRow[] = []): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  if (!rows.length) return out;
  const give = (row: CreativeRow | undefined, badge: Badge) => {
    if (!row) return;
    const list = out.get(row.adId) ?? [];
    if (list.length >= 2) return;
    list.push(badge);
    out.set(row.adId, list);
  };
  const best = (pick: (r: CreativeRow) => number | null, filter: (r: CreativeRow) => boolean = () => true, lowest = false) =>
    rows.filter((r) => filter(r) && pick(r) !== null).sort((a, b) => (lowest ? (pick(a)! - pick(b)!) : (pick(b)! - pick(a)!)))[0];

  const candidates: Record<BadgeKey, () => void> = {
    mais_conversas: () => {
      const r = best((x) => x.conversations, (x) => x.conversations > 0);
      if (r) give(r, { key: "mais_conversas", label: "Mais conversas", tone: "good", detail: `${plural(r.conversations, "conversa")}${r.resultShare !== null ? ` · ${pctRound(r.resultShare)} do total` : ""}` });
    },
    mais_cliques: () => {
      const r = best((x) => x.clicks, (x) => x.clicks > 0);
      if (r) give(r, { key: "mais_cliques", label: "Mais cliques", tone: "good", detail: plural(r.clicks, "clique") });
    },
    melhor_ctr: () => {
      const pool = rows.filter((x) => x.impressions >= 1000 && x.spend >= 5 && x.ctr !== null);
      if (pool.length < 2) return;
      const r = best((x) => x.ctr, (x) => pool.includes(x));
      if (r) give(r, { key: "melhor_ctr", label: "Melhor CTR", tone: "good", detail: `${pctText(r.ctr!)} das exibições viraram clique` });
    },
    maior_investimento: () => {
      const r = best((x) => x.spend);
      if (r && rows.length >= 2 && r.spendShare >= 30) give(r, { key: "maior_investimento", label: "Maior investimento", tone: "neutral", detail: `${money(r.spend)} · ${pctRound(r.spendShare)} da verba` });
    },
    maior_eficiencia: () => {
      const r = best((x) => x.costPerResult, (x) => x.result >= 2 && x.costPerResult !== null, true);
      const others = rows.filter((x) => x.result >= 2).length;
      if (r && others >= 2) give(r, { key: "maior_eficiencia", label: "Maior eficiência", tone: "good", detail: `${money(r.costPerResult)} por ${r.resultUnit}` });
    },
    trafego_sem_conversao: () => {
      if (outcome !== "conversas") return;
      const p75 = percentile(rows.map((x) => x.clicks), 0.75);
      const r = best((x) => x.clicks, (x) => x.conversations === 0 && x.clicks >= 20 && p75 !== null && x.clicks >= p75);
      if (r) give(r, { key: "trafego_sem_conversao", label: "Tráfego sem conversão", tone: "bad", detail: `${plural(r.clicks, "clique")} · nenhuma conversa` });
    },
    atencao_sem_resposta: () => {
      const med = median(rows.map((x) => x.ctr).filter((v): v is number => v !== null));
      if (med === null || rows.length < 3) return;
      const r = best((x) => x.spendShare, (x) => x.spendShare >= 15 && x.ctr !== null && x.ctr < med * 0.5);
      if (r) give(r, { key: "atencao_sem_resposta", label: "Atenção sem resposta", tone: "bad", detail: `${pctRound(r.spendShare)} da verba · ${pctText(r.ctr!)} de clique` });
    },
    saturacao: () => {
      const prevById = new Map(prevRows.map((p) => [p.adId, p]));
      const r = best((x) => x.frequency, (x) => {
        const p = prevById.get(x.adId);
        return x.frequency !== null && x.frequency >= 3 && x.ctr !== null && p?.ctr != null && p.ctr > 0 && (x.ctr - p.ctr) / p.ctr <= -0.25;
      });
      if (r) give(r, { key: "saturacao", label: "Sinal de saturação", tone: "bad", detail: `frequência ${formatAcquisitionValue(r.frequency, "decimal")} e menos cliques por exibição` });
    },
    explica_mudanca: () => {
      if (!prevRows.length) return;
      const prevById = new Map(prevRows.map((p) => [p.adId, p]));
      const deltas = rows.map((r) => ({ r, d: r.result - (prevById.get(r.adId)?.result ?? 0) }));
      const total = deltas.reduce((s, x) => s + x.d, 0) - prevRows.filter((p) => !rows.some((r) => r.adId === p.adId)).reduce((s, p) => s + p.result, 0);
      if (Math.abs(total) < 2) return;
      const top = deltas.filter((x) => Math.sign(x.d) === Math.sign(total)).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
      if (top && Math.abs(top.d) >= Math.abs(total) * 0.3) {
        give(top.r, { key: "explica_mudanca", label: "Explica a mudança", tone: total > 0 ? "good" : "bad", detail: `${signed(top.d)} ${top.r.resultUnit}${Math.abs(top.d) === 1 ? "" : "s"} vs. semana anterior` });
      }
    },
  };

  const order: BadgeKey[] = outcome === "conversas"
    ? ["mais_conversas", "explica_mudanca", "maior_eficiencia", "trafego_sem_conversao", "melhor_ctr", "mais_cliques", "maior_investimento", "atencao_sem_resposta", "saturacao"]
    : ["mais_cliques", "melhor_ctr", "maior_eficiencia", "explica_mudanca", "maior_investimento", "atencao_sem_resposta", "saturacao"];
  for (const key of order) candidates[key]();
  return out;
}

/** Os criativos que ganham cartão: os que têm destaque, na ordem de prioridade
 *  do primeiro destaque. De 1 a 4. */
export function creativeHighlights(rows: CreativeRow[], badges: Map<string, Badge[]>, outcome: MediaOutcome, max = 4): { row: CreativeRow; badges: Badge[] }[] {
  const priority: BadgeKey[] = outcome === "conversas"
    ? ["mais_conversas", "explica_mudanca", "maior_eficiencia", "trafego_sem_conversao", "melhor_ctr", "mais_cliques", "maior_investimento", "atencao_sem_resposta", "saturacao"]
    : ["mais_cliques", "melhor_ctr", "maior_eficiencia", "explica_mudanca", "maior_investimento", "atencao_sem_resposta", "saturacao"];
  return rows
    .filter((r) => badges.has(r.adId))
    .map((r) => ({ row: r, badges: badges.get(r.adId)! }))
    .sort((a, b) => priority.indexOf(a.badges[0].key) - priority.indexOf(b.badges[0].key))
    .slice(0, max);
}

// ---- análises ----------------------------------------------------------------------------

type Candidate = { key: string; score: number; text: string; opensReport: boolean };

export type AnalysisInput = {
  cur: MediaTotals;
  prev: MediaTotals | null;
  outcome: MediaOutcome;
  objectives: ObjectiveRow[];
  creatives: CreativeRow[];
  badges: Map<string, Badge[]>;
};

/** Manchete + até 3 análises. A manchete é sempre uma leitura de RESULTADO; as
 *  demais explicam (concentração, criativo, oportunidade). Formato: resultado →
 *  contexto → interpretação; no máximo dois números por frase. */
export function mediaAnalysis(i: AnalysisInput): { headline: string; insights: string[] } {
  const W = OUTCOME_WORDS[i.outcome];
  const value = outcomeValue(i.cur, i.outcome);
  const cost = outcomeCost(i.cur, i.outcome);
  const prevValue = i.prev ? outcomeValue(i.prev, i.outcome) : null;
  const dSpend = i.prev ? pctChange(i.cur.spend, i.prev.spend) : null;
  const dValue = i.prev ? pctChange(value, prevValue) : null;
  const dCost = i.prev ? pctChange(cost, outcomeCost(i.prev, i.outcome)) : null;
  const dReach = i.prev ? pctChange(i.cur.reach, i.prev.reach) : null;
  const c: Candidate[] = [];

  if (value !== null) {
    if (dValue === null) {
      c.push({ key: "primeira", score: 50, opensReport: true, text: `${num(value)} ${W.plural}${cost !== null ? ` a ${money(cost)} cada` : ""} nesta semana.` });
    } else {
      if (dSpend !== null && dSpend <= -10 && dCost !== null && dCost <= -5) {
        const verb = dValue >= -15 ? "manteve" : "gerou";
        c.push({ key: "eficiencia_menos_verba", score: 95, opensReport: true, text: `Com ${pctRound(dSpend)} menos investimento, a operação ${verb} ${num(value)} ${W.plural} a um custo ${pctRound(dCost)} menor.` });
      }
      if (dValue >= 5 && dCost !== null && dCost <= -5) {
        c.push({ key: "mais_e_mais_barato", score: 90, opensReport: true, text: `Mais ${W.plural} (${num(value)}, ${pctRound(dValue)} a mais), e cada uma saiu ${pctRound(dCost)} mais barata.` });
      }
      if (dReach !== null && dReach <= -15 && Math.abs(dValue) < 5) {
        c.push({ key: "estavel_com_menos_alcance", score: 85, opensReport: true, text: `Mesmo com alcance ${pctRound(dReach)} menor, as ${W.plural} ficaram estáveis em ${num(value)}.` });
      }
      if (dSpend !== null && dSpend >= 10 && dValue >= 10) {
        c.push({ key: "mais_verba_mais_resultado", score: 70, opensReport: true, text: `Com mais investimento, as ${W.plural} cresceram ${pctRound(dValue)}${dCost !== null && dCost >= 5 ? `, a um custo ${pctRound(dCost)} maior por ${W.unit}` : ""}.` });
      }
      if (dValue <= -10 && dCost !== null && dCost >= 5) {
        c.push({ key: "queda_mais_caro", score: 60, opensReport: true, text: `As ${W.plural} caíram ${pctRound(dValue)} e cada uma ficou ${pctRound(dCost)} mais cara.` });
      }
      if (dValue <= -10) {
        c.push({ key: "queda", score: 45, opensReport: true, text: `${W.Plural} ${dValue <= -30 ? "recuaram" : "caíram"} ${pctRound(dValue)} em relação à semana anterior, para ${num(value)}.` });
      }
      c.push({ key: "estavel", score: 40, opensReport: true, text: `${num(value)} ${W.plural}${cost !== null ? ` a ${money(cost)} cada` : ""}${Math.abs(dValue) < 5 ? ", no mesmo patamar da semana anterior" : dValue > 0 ? `, ${pctRound(dValue)} a mais que na semana anterior` : ""}.` });
    }
  }

  // Concentração: um objetivo entrega muito mais resultado do que a verba que recebe.
  const withShares = i.objectives.filter((o) => o.spendShare && o.resultShare !== null);
  if (withShares.length >= 2) {
    const top = [...withShares].sort((a, b) => b.resultShare! / b.spendShare! - a.resultShare! / a.spendShare!)[0];
    if (top.resultShare! / top.spendShare! >= 1.5) {
      c.push({ key: "concentracao", score: 88, opensReport: false, text: `${top.label} concentrou o resultado: recebeu ${pctRound(top.spendShare!)} da verba e gerou ${pctRound(top.resultShare!)} das ${W.plural}.` });
    }
  }

  // Criativos.
  const topCreative = [...i.creatives].sort((a, b) => b.result - a.result)[0];
  if (topCreative?.resultShare !== null && topCreative && topCreative.resultShare! >= 50 && i.creatives.length >= 2) {
    c.push({ key: "criativo_concentra", score: 80, opensReport: false, text: `${topCreative.name} concentrou ${pctRound(topCreative.resultShare!)} das ${topCreative.resultUnit === "conversa" ? "conversas" : `${topCreative.resultUnit}s`}.` });
  }
  for (const r of i.creatives) {
    const b = i.badges.get(r.adId) ?? [];
    if (b.some((x) => x.key === "trafego_sem_conversao")) {
      c.push({ key: "trafego_sem_conversao", score: 65, opensReport: false, text: `${r.name} levou ${plural(r.clicks, "clique")}, mas nenhuma conversa.` });
    }
    if (b.some((x) => x.key === "maior_eficiencia") && r.spendShare < 20) {
      c.push({ key: "oportunidade", score: 75, opensReport: false, text: `${r.name} teve o menor custo por ${r.resultUnit} (${money(r.costPerResult)}) com só ${pctRound(r.spendShare)} da verba.` });
    }
  }

  const sorted = [...c].sort((a, b) => b.score - a.score);
  const head = sorted.find((x) => x.opensReport);
  const rest = sorted.filter((x) => x !== head && (!x.opensReport || x.score >= 60));
  const seen = new Set<string>();
  const insights = rest.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true))).slice(0, 3).map((x) => x.text);
  return { headline: head?.text ?? "Semana sem resultado registrado pela mídia.", insights };
}

// ---- alerta --------------------------------------------------------------------------------

/** No máximo um. Só quando o resultado da conta, ou o de um objetivo, piorou de
 *  verdade — métrica intermediária cara com resultado saudável não é alerta. */
export function mediaAlert(i: AnalysisInput): string | null {
  const W = OUTCOME_WORDS[i.outcome];
  if (i.prev) {
    const dValue = pctChange(outcomeValue(i.cur, i.outcome), outcomeValue(i.prev, i.outcome));
    const dCost = pctChange(outcomeCost(i.cur, i.outcome), outcomeCost(i.prev, i.outcome));
    if (dValue !== null && dCost !== null && dValue <= -20 && dCost >= 20) {
      return `${W.Plural} caíram ${pctRound(dValue)} e o custo por ${W.unit} subiu ${pctRound(dCost)}.`;
    }
    // Métrica técnica só vira alerta quando o objetivo também perdeu resultado de
    // forma relevante E ficou mais caro por resultado. CPE +305% com o
    // Engajamento mantendo o custo por conversa é assunto da tabela, não alerta.
    const objective = i.objectives.find((o) =>
      o.technical?.critical && o.resultDelta.pct !== null && o.resultDelta.pct <= -20 && o.costDelta.pct !== null && o.costDelta.pct >= 10);
    if (objective?.technical) {
      return `${objective.label}: ${objective.technical.explanation.charAt(0).toLowerCase()}${objective.technical.explanation.slice(1, -1)}, e o resultado do objetivo caiu ${pctRound(objective.resultDelta.pct!)}.`;
    }
  }
  // Desperdício é verba sem resultado E sem atenção. Um criativo que leva muitos
  // cliques e nenhuma conversa é "tráfego sem conversão" — destaque, não alerta.
  const clickMedian = median(i.creatives.map((r) => r.clicks)) ?? 0;
  const waste = i.creatives.find((r) => r.spendShare >= 25 && r.result === 0 && r.clicks < clickMedian);
  if (waste) return `${waste.name} recebeu ${pctRound(waste.spendShare)} da verba sem gerar ${W.plural}.`;
  return null;
}

// ---- tendência -------------------------------------------------------------------------------

export type TrendPoint = { weekTo: string; spend: number; result: number; cost: number | null };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Semanas fechadas terminando em `periodTo`, da mais antiga à mais recente. Só
 *  entra semana com investimento. */
export function weeklyTrend(posts: MetaPost[], periodTo: string, outcome: MediaOutcome, weeks = 6): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const to = addDays(periodTo, -7 * k);
    const from = addDays(to, -6);
    const t = mediaTotals(posts.filter((p) => p.date >= from && p.date <= to));
    if (!t.spend) continue;
    const result = outcomeValue(t, outcome) ?? 0;
    out.push({ weekTo: to, spend: t.spend, result, cost: result > 0 ? t.spend / result : null });
  }
  return out;
}
