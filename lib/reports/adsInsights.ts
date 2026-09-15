// A leitura do relatório de anúncios, calculada antes de desenhar — puro, sem
// PDF e sem banco. Os dois relatórios consomem isto: o de anúncios como
// assunto principal, o de resultados como contexto da conversão.
//
// Três regras de produto moram aqui, e não no layout:
//
// 1. Métrica técnica (custo por clique, custo por engajamento, taxa de clique)
//    é jargão para o cliente. Só aparece quando é CRÍTICA — piorou muito — e
//    sempre com uma frase em português dizendo o que aconteceu. Fora disso o
//    espaço dela é reaproveitado por um número que qualquer dono de negócio lê.
// 2. Investimento é NEUTRO: gastar mais ou menos não é bom nem ruim sozinho.
// 3. Nenhuma frase afirma causa. "Perdeu alcance e as conversas caíram" descreve
//    dois movimentos; "as conversas caíram PORQUE perdeu alcance" não pode.

import { campaignSummaries, recomputeRatios, sumMetricsInto } from "@/app/admin/performance/insights";
import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import { CAMPAIGN_BLOCK_LABEL, type CampaignBlock } from "@/lib/performanceTemplates";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";

export type Metrics = Partial<Record<MetaPostMetricKey, number>>;
export type Tone = "good" | "bad" | "neutral";
export type Direction = "higher_is_better" | "lower_is_better" | "neutral";

/** Abaixo disto a variação não ganha cor — é oscilação, não sinal. */
const TONE_THRESHOLD = 5;
/** A partir disto uma métrica técnica de custo vira CRÍTICA e ganha espaço. */
export const CRITICAL_COST_INCREASE = 30;

// ---- formatação ---------------------------------------------------------------

export const money = (v: number | null) => formatAcquisitionValue(v, "money");
export const num = (v: number | null) => formatAcquisitionValue(v);
export const pctText = (v: number) => `${formatAcquisitionValue(Math.abs(v), "decimal")}%`;

export type Delta = { pct: number | null; tone: Tone; text: string };

export function deltaOf(current: number | null, previous: number | null, direction: Direction): Delta {
  if (current === null || previous === null || previous === 0) return { pct: null, tone: "neutral", text: "sem semana anterior" };
  const pct = ((current - previous) / previous) * 100;
  const arrow = pct >= 0 ? "↑" : "↓";
  const text = `${arrow} ${pctText(pct)}`;
  if (direction === "neutral" || Math.abs(pct) < TONE_THRESHOLD) return { pct, tone: "neutral", text };
  const better = direction === "higher_is_better" ? pct > 0 : pct < 0;
  return { pct, tone: better ? "good" : "bad", text };
}

// ---- totais -----------------------------------------------------------------

export type MediaTotals = {
  spend: number | null;
  reach: number | null;
  clicks: number | null;
  conversations: number | null;
  profileVisits: number | null;
  engagement: number | null;
  impressions: number | null;
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

/** Soma das campanhas pagas do período. Alcance somado entre campanhas pode
 *  contar a mesma pessoa duas vezes — o relatório chama isso de "alcance das
 *  campanhas", não de "pessoas únicas". */
export function mediaTotals(posts: MetaPost[]): MediaTotals {
  const paid = posts.filter((p) => p.source === "paid");
  const spend = sumKey(paid, "custo");
  const conversations = sumKey(paid, "contatos") ?? (paid.length ? 0 : null);
  return {
    spend,
    reach: sumKey(paid, "alcance"),
    clicks: sumKey(paid, "cliques") ?? sumKey(paid, "cliquesLink"),
    conversations,
    profileVisits: sumKey(paid, "profileVisits"),
    engagement: sumKey(paid, "engajamento"),
    impressions: sumKey(paid, "impressoes"),
    costPerConversation: spend !== null && conversations ? spend / conversations : null,
  };
}

// ---- por objetivo -----------------------------------------------------------

/** O custo que define a eficiência de cada objetivo, e como dizê-lo em
 *  português quando ele precisar aparecer. */
const EFFICIENCY: Record<CampaignBlock, { metric: MetaPostMetricKey; technical: string; unit: string } | null> = {
  trafego_site: { metric: "cliquesLink", technical: "CPC", unit: "clique no site" },
  trafego_perfil: { metric: "profileVisits", technical: "custo por visita", unit: "visita ao perfil" },
  mensagens: { metric: "contatos", technical: "custo por conversa", unit: "conversa" },
  engajamento: { metric: "engajamento", technical: "CPE", unit: "engajamento" },
  outro: { metric: "cliques", technical: "CPC", unit: "clique" },
};

/** Os números "de leigo" de cada objetivo — sem custo unitário, sem taxa. */
const PLAIN_SLOTS: Record<CampaignBlock, { metric: MetaPostMetricKey; label: string }[]> = {
  trafego_site: [
    { metric: "alcance", label: "Alcance" },
    { metric: "cliquesLink", label: "Cliques no site" },
    { metric: "profileVisits", label: "Visitas ao perfil" },
    { metric: "contatos", label: "Conversas" },
  ],
  trafego_perfil: [
    { metric: "alcance", label: "Alcance" },
    { metric: "profileVisits", label: "Visitas ao perfil" },
    { metric: "contatos", label: "Conversas" },
  ],
  mensagens: [
    { metric: "alcance", label: "Alcance" },
    { metric: "cliques", label: "Cliques" },
    { metric: "contatos", label: "Conversas" },
  ],
  engajamento: [
    { metric: "alcance", label: "Alcance" },
    { metric: "engajamento", label: "Interações" },
    { metric: "profileVisits", label: "Visitas ao perfil" },
    { metric: "contatos", label: "Conversas" },
  ],
  outro: [
    { metric: "alcance", label: "Alcance" },
    { metric: "cliques", label: "Cliques" },
    { metric: "contatos", label: "Conversas" },
  ],
};

export type Slot = { label: string; value: string; delta: Delta; note?: string };

export type EfficiencySignal = {
  block: CampaignBlock;
  objective: string;
  technical: string;
  cost: number;
  delta: Delta;
  critical: boolean;
  /** A frase que substitui o jargão: sempre existe, mesmo quando não crítica. */
  explanation: string;
};

export type ObjectiveSummary = {
  block: CampaignBlock;
  label: string;
  spend: number | null;
  spendShare: number | null;
  conversations: number | null;
  conversationShare: number | null;
  slots: Slot[];
  efficiency: EfficiencySignal | null;
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

export function efficiencyOf(block: CampaignBlock, cur: Metrics, prev: Metrics | undefined): EfficiencySignal | null {
  const def = EFFICIENCY[block];
  if (!def) return null;
  const spend = cur.custo;
  const volume = cur[def.metric];
  if (!spend || !volume) return null;
  const cost = spend / volume;
  const prevCost = prev?.custo && prev[def.metric] ? prev.custo / (prev[def.metric] as number) : null;
  const delta = deltaOf(cost, prevCost, "lower_is_better");
  const critical = delta.pct !== null && delta.pct >= CRITICAL_COST_INCREASE;
  const objective = CAMPAIGN_BLOCK_LABEL[block];
  const explanation = delta.pct === null
    ? `Cada ${def.unit} custou ${money(cost)}.`
    : `Cada ${def.unit} custou ${money(cost)} — ${pctText(delta.pct)} ${delta.pct >= 0 ? "mais caro" : "mais barato"} que na semana anterior.`;
  return { block, objective, technical: def.technical, cost, delta, critical, explanation };
}

export function objectiveSummaries(
  posts: MetaPost[],
  prevPosts: MetaPost[],
  blockOf: (p: MetaPost) => CampaignBlock,
): ObjectiveSummary[] {
  const cur = aggregate(posts, blockOf);
  const prev = aggregate(prevPosts, blockOf);
  const totalSpend = [...cur.values()].reduce((s, m) => s + (m.custo ?? 0), 0);
  const totalConv = [...cur.values()].reduce((s, m) => s + (m.contatos ?? 0), 0);

  return [...cur.entries()]
    .map(([block, m]) => {
      const p = prev.get(block);
      const efficiency = efficiencyOf(block, m, p);
      const spendShare = totalSpend > 0 && m.custo !== undefined ? (m.custo / totalSpend) * 100 : null;
      const conversationShare = totalConv > 0 ? ((m.contatos ?? 0) / totalConv) * 100 : null;
      const slots: Slot[] = PLAIN_SLOTS[block]
        .filter((s) => m[s.metric] !== undefined || s.metric === "contatos")
        .map((s) => ({
          label: s.label,
          value: num(m[s.metric] ?? 0),
          delta: deltaOf(m[s.metric] ?? 0, p ? p[s.metric] ?? 0 : null, "higher_is_better"),
        }));
      // O slot da métrica técnica: só com a métrica quando ela é crítica —
      // senão o espaço vira um número que o cliente entende sem legenda.
      if (efficiency?.critical) {
        slots.push({ label: `${efficiency.technical} · atenção`, value: money(efficiency.cost), delta: efficiency.delta, note: efficiency.explanation });
      } else if (spendShare !== null && spendShare < 99.5) {
        // Com um objetivo só, "100% da verba" não informa nada.
        slots.push({ label: "Parte da verba", value: `${formatAcquisitionValue(spendShare, "decimal")}%`, delta: { pct: null, tone: "neutral", text: "do investimento" } });
      }
      if (conversationShare !== null) {
        slots.push({ label: "Parte das conversas", value: `${formatAcquisitionValue(conversationShare, "decimal")}%`, delta: { pct: null, tone: "neutral", text: "do total da semana" } });
      }
      return {
        block,
        label: CAMPAIGN_BLOCK_LABEL[block],
        spend: m.custo ?? null,
        spendShare,
        conversations: m.contatos ?? null,
        conversationShare,
        slots: slots.slice(0, 6),
        efficiency,
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
}

// ---- criativos --------------------------------------------------------------

export type CreativeReading = "conversas" | "cliques" | "revisar" | "estavel";

export type CreativeRow = {
  adId: string;
  name: string;
  campaignName: string;
  thumbnailUrl: string | null;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  conversations: number;
  /** Cliques a cada 100 exibições — a taxa de clique dita em português. */
  clicksPer100: number | null;
  reading: CreativeReading;
};

export type CreativeHighlight = { tag: string; tone: Tone; name: string; value: string; detail: string };

/** Gasto e exibição irrisórios não viram linha: um anúncio com 4 exibições e
 *  R$ 0,07 ocupava uma das poucas vagas da tabela sem dizer nada. */
const NOISE_SPEND = 2;
const NOISE_IMPRESSIONS = 100;

export function creativeRows(adPosts: MetaPost[]): { rows: CreativeRow[]; hiddenNoise: number } {
  const byId = new Map<string, CreativeRow & { metrics: Metrics }>();
  for (const p of adPosts) {
    if (!p.adId) continue;
    const row = byId.get(p.adId) ?? {
      adId: p.adId,
      name: p.adName || p.caption || p.adId,
      campaignName: p.campaignName ?? "",
      thumbnailUrl: p.thumbnailUrl ?? null,
      spend: 0, reach: 0, impressions: 0, clicks: 0, conversations: 0, clicksPer100: null,
      reading: "estavel" as CreativeReading,
      metrics: {} as Metrics,
    };
    sumMetricsInto(row.metrics, p.metrics);
    byId.set(p.adId, row);
  }
  const all = [...byId.values()].map((r) => {
    const m = r.metrics;
    const clicks = m.cliquesLink ?? m.cliques ?? 0;
    const impressions = m.impressoes ?? 0;
    return {
      adId: r.adId, name: r.name, campaignName: r.campaignName, thumbnailUrl: r.thumbnailUrl,
      spend: m.custo ?? 0, reach: m.alcance ?? 0, impressions, clicks, conversations: m.contatos ?? 0,
      clicksPer100: impressions > 0 ? (clicks / impressions) * 100 : null,
      reading: "estavel" as CreativeReading,
    };
  });
  const relevant = all.filter((r) => r.spend >= NOISE_SPEND || r.impressions >= NOISE_IMPRESSIONS);
  const totalSpend = relevant.reduce((s, r) => s + r.spend, 0);

  const byConv = [...relevant].sort((a, b) => b.conversations - a.conversations || b.spend - a.spend);
  if (byConv[0]?.conversations > 0) byConv[0].reading = "conversas";
  const byClicks = [...relevant].filter((r) => r.reading === "estavel").sort((a, b) => b.clicks - a.clicks);
  if (byClicks[0]?.clicks > 0) byClicks[0].reading = "cliques";
  const totalConversations = relevant.reduce((s, r) => s + r.conversations, 0);
  const relevantSpend = (r: { spend: number }) => totalSpend > 0 && r.spend >= Math.max(5, totalSpend * 0.1);
  if (totalConversations > 0) {
    // Revisar: levou fatia relevante da verba e não trouxe conversa nenhuma.
    for (const r of relevant) {
      if (r.reading === "estavel" && r.conversations === 0 && relevantSpend(r)) r.reading = "revisar";
    }
  } else {
    // Conta que não recebe conversa (perfil, loja física): "sem conversa" não é
    // defeito do criativo — é o normal da conta, e marcaria todos como
    // "revisar". Aqui o sinal é responder a clique bem abaixo dos pares.
    const rates = relevant.map((r) => r.clicksPer100).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const median = rates.length >= 3 ? rates[Math.floor(rates.length / 2)] : null;
    for (const r of relevant) {
      if (median !== null && r.reading === "estavel" && r.clicksPer100 !== null && r.clicksPer100 < median * 0.5 && relevantSpend(r)) r.reading = "revisar";
    }
  }
  const order: Record<CreativeReading, number> = { conversas: 0, cliques: 1, revisar: 2, estavel: 3 };
  relevant.sort((a, b) => order[a.reading] - order[b.reading] || b.spend - a.spend);
  return { rows: relevant, hiddenNoise: all.length - relevant.length };
}

export const READING_LABEL: Record<CreativeReading, string> = {
  conversas: "★ Mais conversas",
  cliques: "★ Mais cliques",
  revisar: "! Revisar",
  estavel: "— Estável",
};

/** Os três cartões de destaque. Linguagem de dono de negócio: "gastou R$ 54 sem
 *  gerar conversa", nunca "CTR 0,38%" sozinho. */
export function creativeHighlights(rows: CreativeRow[], totalConversations: number | null): CreativeHighlight[] {
  const out: CreativeHighlight[] = [];
  const conv = rows.find((r) => r.reading === "conversas");
  if (conv) {
    const share = totalConversations ? ` · ${formatAcquisitionValue((conv.conversations / totalConversations) * 100, "decimal")}% das conversas` : "";
    out.push({ tag: "★ Mais conversas", tone: "good", name: conv.name, value: `${num(conv.conversations)} conversas`, detail: `${money(conv.spend)} investidos${share}` });
  }
  const clicks = rows.find((r) => r.reading === "cliques");
  if (clicks) {
    out.push({
      tag: "★ Mais cliques",
      tone: "good",
      name: clicks.name,
      value: `${num(clicks.clicks)} cliques`,
      detail: !totalConversations
        ? `${money(clicks.spend)} investidos`
        : clicks.conversations === 0 ? "levou gente ao site, mas nenhuma conversa" : `${num(clicks.conversations)} conversas · ${money(clicks.spend)} investidos`,
    });
  }
  const review = rows.find((r) => r.reading === "revisar");
  if (review) {
    const rate = review.clicksPer100 !== null ? ` · ${formatAcquisitionValue(review.clicksPer100, "decimal")} clique a cada 100 exibições` : "";
    out.push({
      tag: "! Revisar",
      tone: "bad",
      name: review.name,
      value: money(review.spend),
      detail: totalConversations ? `investidos sem gerar conversa${rate}` : `investidos com resposta abaixo dos outros criativos${rate}`,
    });
  }
  return out;
}

// ---- frase ------------------------------------------------------------------

export type MediaNarrative = { headline: string; body: string };

/** O desfecho que a mídia entrega para ESTE cliente. Conversa quando existe
 *  volume; para quem quase não recebe mensagem (perfil de loja, foco em
 *  seguidores) o desfecho mensurável é a visita ao perfil. */
export type MediaOutcome = "conversas" | "visitas";

export const OUTCOME_WORDS: Record<MediaOutcome, { plural: string; Plural: string; unit: string }> = {
  conversas: { plural: "conversas", Plural: "Conversas", unit: "conversa" },
  visitas: { plural: "visitas ao perfil", Plural: "Visitas ao perfil", unit: "visita" },
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

export function mediaNarrative(cur: MediaTotals, prev: MediaTotals | null, comparedWith: string | null, outcome: MediaOutcome = "conversas"): MediaNarrative {
  const W = OUTCOME_WORDS[outcome];
  const value = outcomeValue(cur, outcome);
  const cost = outcomeCost(cur, outcome);
  const prevValue = prev ? outcomeValue(prev, outcome) : null;
  if (!prev || prevValue === null) {
    return {
      headline: value !== null ? `${num(value)} ${W.plural}${cost !== null ? ` a ${money(cost)} cada` : ""} nesta semana.` : `Semana sem ${W.plural} registradas pela mídia.`,
      body: "Primeira semana com dados completos — a próxima leitura compara com esta.",
    };
  }
  const dVal = deltaOf(value, prevValue, "higher_is_better").pct ?? 0;
  const dReach = deltaOf(cur.reach, prev.reach, "higher_is_better").pct ?? 0;
  const dCost = deltaOf(cost, outcomeCost(prev, outcome), "lower_is_better").pct ?? 0;
  const up = (v: number) => v >= TONE_THRESHOLD;
  const down = (v: number) => v <= -TONE_THRESHOLD;
  const flat = (v: number) => !up(v) && !down(v);

  let headline: string;
  if (up(dVal) && down(dCost)) headline = `Mais ${W.plural}, e cada uma saiu mais barata.`;
  else if (up(dVal) && up(dCost)) headline = `Mais ${W.plural}, mas cada uma custou mais.`;
  else if (up(dVal)) headline = `Mais ${W.plural} com custo por ${W.unit} estável.`;
  else if (down(dVal) && up(dCost)) headline = `${W.Plural} caíram e ficaram mais caras.`;
  else if (down(dVal) && down(dReach) && dReach <= -15) headline = `A mídia perdeu alcance e as ${W.plural} também caíram.`;
  else if (down(dVal)) headline = `${W.Plural} caíram em relação à semana anterior.`;
  else if (flat(dVal) && dReach <= -15) headline = `A mídia perdeu alcance, mas manteve as ${W.plural}.`;
  else if (flat(dVal) && down(dCost)) headline = `Mesmo volume de ${W.plural}, a um custo menor.`;
  else headline = `Semana estável em ${W.plural} e custo.`;

  const part = (label: string, v: number) => `${label} ${v >= 0 ? "↑" : "↓"} ${pctText(v)}`;
  const body = `${part("Alcance", dReach)} · ${part(W.plural, dVal)} · ${part(`custo por ${W.unit}`, dCost)}${comparedWith ? ` em relação a ${comparedWith}` : ""}.`;
  return { headline, body };
}

/** O cartão "ponto de atenção": a métrica técnica mais crítica, explicada; sem
 *  nada crítico, o espaço fica com o objetivo que mais trouxe conversas. */
export function attentionCard(objectives: ObjectiveSummary[]): { label: string; value: string; detail: string; tone: Tone } | null {
  const critical = objectives
    .map((o) => o.efficiency)
    .filter((e): e is EfficiencySignal => Boolean(e?.critical))
    .sort((a, b) => (b.delta.pct ?? 0) - (a.delta.pct ?? 0))[0];
  if (critical) {
    return {
      label: `Atenção · ${critical.objective}`,
      // Sem seta: o valor sai em Fraunces, que não tem "↑".
      value: `${critical.technical} ${(critical.delta.pct ?? 0) >= 0 ? "+" : "-"}${pctText(critical.delta.pct ?? 0)}`,
      detail: critical.explanation,
      tone: "bad",
    };
  }
  const best = [...objectives].filter((o) => (o.conversations ?? 0) > 0).sort((a, b) => (b.conversations ?? 0) - (a.conversations ?? 0))[0];
  if (!best) return null;
  return {
    label: "Objetivo que mais conversou",
    value: best.label,
    detail: `${num(best.conversations)} conversas${best.conversationShare !== null ? ` · ${formatAcquisitionValue(best.conversationShare, "decimal")}% do total` : ""}${best.spendShare !== null ? ` com ${formatAcquisitionValue(best.spendShare, "decimal")}% da verba` : ""}.`,
    tone: "neutral",
  };
}

/** Uma campanha por objetivo, para quem prefere nomes — usado no rodapé de
 *  cada painel ("3 campanhas"). */
export function campaignCountByBlock(posts: MetaPost[], blockOf: (p: MetaPost) => CampaignBlock): Map<CampaignBlock, number> {
  const out = new Map<CampaignBlock, Set<string>>();
  for (const c of campaignSummaries(posts)) {
    const fake = { campaignId: c.campaignId, campaignName: c.caption, caption: c.caption, objective: c.objective } as MetaPost;
    const block = blockOf(fake);
    const set = out.get(block) ?? new Set<string>();
    set.add(c.campaignId || c.caption);
    out.set(block, set);
  }
  return new Map([...out.entries()].map(([k, v]) => [k, v.size]));
}
