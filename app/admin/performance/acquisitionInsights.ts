import { applyOp } from "./insights";
import { customMetricIdOf, isCustomMetricRef, type CustomMetric, type MetricRef } from "@/lib/performancePrefs";
import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";

export type NullableMetric = number | null;

export type AcquisitionSummary = {
  spend: NullableMetric;
  opportunities: NullableMetric;
  costPerLead: NullableMetric;
  impressions: NullableMetric;
  clicks: NullableMetric;
  conversionRate: NullableMetric;
  reach: NullableMetric;
  messages: NullableMetric;
  cpm: NullableMetric;
  cpc: NullableMetric;
  ctr: NullableMetric;
  messageClickCount: NullableMetric;
  messageClickBasis: "link" | "all" | null;
  clickToMessageRate: NullableMetric;
};

export type AcquisitionDay = {
  date: string;
  spend: NullableMetric;
  messages: NullableMetric;
};

export type CreativePerformanceRow = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  clicks: NullableMetric;
  leads: NullableMetric;
  cpa: NullableMetric;
  ctr: NullableMetric;
};

export function totalWhenPresent(posts: MetaPost[], key: MetaPostMetricKey): NullableMetric {
  let total = 0;
  let present = false;
  for (const post of posts) {
    const value = post.metrics[key];
    if (value === undefined) continue;
    present = true;
    total += value;
  }
  return present ? total : null;
}

export function ratio(numerator: NullableMetric, denominator: NullableMetric, multiplier = 1): NullableMetric {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * multiplier;
}

// ---- Formatação null-conscious (compartilhada tela + PDF) ------------------
// A regra de "— para ausente, nunca 0" só faz sentido junto das funções
// null-aware acima. `AcquisitionDashboard` e `lib/reports/adsReportPdf.tsx`
// usam exatamente estas — não recriar uma terceira cópia com opções
// ligeiramente diferentes.

export type MetricKind = "number" | "money" | "percent" | "decimal";

const NUMBER_FMT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DECIMAL_FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const MONEY_FMT = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export function formatAcquisitionValue(value: NullableMetric, kind: MetricKind = "number"): string {
  if (value === null) return "—";
  if (kind === "money") return MONEY_FMT.format(value);
  if (kind === "percent") return `${DECIMAL_FMT.format(value)}%`;
  if (kind === "decimal") return DECIMAL_FMT.format(value);
  return NUMBER_FMT.format(value);
}

/** Variação percentual; `null` quando não há base de comparação. */
export function acquisitionDelta(current: NullableMetric, previous: NullableMetric): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Taxa entre duas etapas do funil, já formatada (`"12,3%"` ou `"—"`). */
export function acquisitionRateLabel(numerator: NullableMetric, denominator: NullableMetric): string {
  const value = ratio(numerator, denominator, 100);
  return value === null ? "—" : `${DECIMAL_FMT.format(value)}%`;
}

export function summarizeAcquisition(posts: MetaPost[]): AcquisitionSummary {
  const spend = totalWhenPresent(posts, "custo");
  const opportunities = totalWhenPresent(posts, "leads");
  const impressions = totalWhenPresent(posts, "impressoes");
  const clicks = totalWhenPresent(posts, "cliques");
  const linkClicks = totalWhenPresent(posts, "cliquesLink");
  const reach = totalWhenPresent(posts, "alcance");
  const messages = totalWhenPresent(posts, "mensagens");
  const messageClickCount = linkClicks !== null ? linkClicks : clicks;
  return {
    spend,
    opportunities,
    costPerLead: ratio(spend, opportunities),
    impressions,
    clicks,
    conversionRate: ratio(opportunities, clicks, 100),
    reach,
    messages,
    cpm: ratio(spend, impressions, 1000),
    cpc: ratio(spend, clicks),
    ctr: ratio(clicks, impressions, 100),
    messageClickCount,
    messageClickBasis: linkClicks !== null ? "link" : clicks !== null ? "all" : null,
    clickToMessageRate: ratio(messages, messageClickCount, 100),
  };
}

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function acquisitionDailySeries(posts: MetaPost[], from: string, to: string): AcquisitionDay[] {
  const days: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(isoDay(cursor));
  }
  return days.map((date) => {
    const rows = posts.filter((post) => post.date === date);
    return { date, spend: totalWhenPresent(rows, "custo"), messages: totalWhenPresent(rows, "mensagens") };
  });
}

export function filterAcquisitionPosts(posts: MetaPost[], campaignId: string, adsetId: string): MetaPost[] {
  return posts.filter((post) =>
    post.source === "paid" &&
    (!campaignId || post.campaignId === campaignId) &&
    (!adsetId || post.adsetId === adsetId),
  );
}

// ---- Configurable metrics for Aquisição's cards (Parte 5a) — null-conscious
// counterparts of insights.ts's resolveMetricValue/trendSeries. Never
// fabricate a 0 for missing data and never average a ratio per-day; ratio
// metrics are always derived from summed volume, same rule as
// summarizeAcquisition above (ctr/cpm/cpc via totalWhenPresent + ratio()).

function resolveBuiltinAcquisitionMetric(posts: MetaPost[], key: MetaPostMetricKey): NullableMetric {
  if (key === "ctr") return ratio(totalWhenPresent(posts, "cliques"), totalWhenPresent(posts, "impressoes"), 100);
  if (key === "cpc") return ratio(totalWhenPresent(posts, "custo"), totalWhenPresent(posts, "cliques"));
  if (key === "cpm") return ratio(totalWhenPresent(posts, "custo"), totalWhenPresent(posts, "impressoes"), 1000);
  if (key === "frequencia") return ratio(totalWhenPresent(posts, "impressoes"), totalWhenPresent(posts, "alcance"));
  return totalWhenPresent(posts, key);
}

function findCustomMetric(ref: MetricRef, customMetrics: CustomMetric[]): CustomMetric | undefined {
  return customMetrics.find((metric) => metric.id === customMetricIdOf(ref));
}

export function resolveAcquisitionMetric(posts: MetaPost[], ref: MetricRef, customMetrics: CustomMetric[]): NullableMetric {
  if (isCustomMetricRef(ref)) {
    const def = findCustomMetric(ref, customMetrics);
    if (!def) return null;
    const a = resolveBuiltinAcquisitionMetric(posts, def.a);
    const b = resolveBuiltinAcquisitionMetric(posts, def.b);
    if (a === null || b === null) return null;
    return applyOp(a, def.op, b);
  }
  return resolveBuiltinAcquisitionMetric(posts, ref);
}

export function acquisitionMetricAvailable(posts: MetaPost[], ref: MetricRef, customMetrics: CustomMetric[]): boolean {
  return resolveAcquisitionMetric(posts, ref, customMetrics) !== null;
}

export function acquisitionMetricLabel(ref: MetricRef, customMetrics: CustomMetric[], builtinLabel: (key: MetaPostMetricKey) => string): string {
  if (isCustomMetricRef(ref)) return findCustomMetric(ref, customMetrics)?.label ?? "Métrica removida";
  return builtinLabel(ref);
}

// Same day-then-derive approach as insights.ts's trendSeries fix — a ratio
// metric is never averaged/summed per day, it's recomputed from that day's
// summed components.
export function acquisitionMetricSeries(posts: MetaPost[], ref: MetricRef, from: string, to: string, customMetrics: CustomMetric[]): { date: string; value: NullableMetric }[] {
  const days: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(isoDay(cursor));
  }
  return days.map((date) => {
    const rows = posts.filter((post) => post.date === date);
    return { date, value: resolveAcquisitionMetric(rows, ref, customMetrics) };
  });
}

export function creativePerformanceRows(posts: MetaPost[]): CreativePerformanceRow[] {
  const groups = new Map<string, MetaPost[]>();
  for (const post of posts) {
    if (!post.adId) continue;
    const group = groups.get(post.adId);
    if (group) group.push(post);
    else groups.set(post.adId, [post]);
  }
  return Array.from(groups.entries()).map(([id, rows]) => {
    const summary = summarizeAcquisition(rows);
    return {
      id,
      name: rows[0].adName || rows[0].caption || id,
      thumbnailUrl: rows.find((row) => row.thumbnailUrl)?.thumbnailUrl ?? null,
      clicks: summary.clicks,
      leads: summary.opportunities,
      cpa: summary.costPerLead,
      ctr: summary.ctr,
    };
  }).sort((a, b) => (b.leads ?? -1) - (a.leads ?? -1));
}
