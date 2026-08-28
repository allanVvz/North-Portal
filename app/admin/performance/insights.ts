import { customMetricIdOf, isCustomMetricRef, type CustomMetric, type CustomMetricOp, type MetricRef, type SortDir } from "@/lib/performancePrefs";
import type { MetaPlatform, MetaPost, MetaPostMetricKey } from "@/lib/windsor";

// Pure aggregation helpers behind the Performance dashboard — everything the
// charts/KPIs/table consume is computed here from a MetaPost[], so the whole
// layer is unit-testable without Windsor or the DB.

export type Period = { from: string; to: string }; // YYYY-MM-DD, inclusive

// Metric vocabulary the dashboard can plot. Paid-only metrics are gated by
// the caller (only shown when the paid datasource is connected).
export const DASH_METRICS: { key: MetaPostMetricKey; label: string; paidOnly: boolean }[] = [
  { key: "alcance", label: "Alcance", paidOnly: false },
  { key: "impressoes", label: "Impressões", paidOnly: false },
  { key: "engajamento", label: "Engajamento", paidOnly: false },
  { key: "likes", label: "Reações", paidOnly: false },
  { key: "comentarios", label: "Comentários", paidOnly: false },
  { key: "compartilhamentos", label: "Compartilhamentos", paidOnly: false },
  { key: "salvos", label: "Salvamentos", paidOnly: false },
  { key: "videoViews", label: "Views de vídeo", paidOnly: false },
  { key: "cliques", label: "Cliques (todos)", paidOnly: true },
  { key: "cliquesLink", label: "Cliques no link", paidOnly: true },
  { key: "landingPageViews", label: "Visitas à página", paidOnly: true },
  { key: "profileVisits", label: "Visitas ao perfil", paidOnly: false },
  { key: "followers", label: "Seguidores", paidOnly: false },
  { key: "followersGained", label: "Novos seguidores", paidOnly: false },
  { key: "mensagens", label: "Conversas iniciadas", paidOnly: true },
  { key: "leads", label: "Leads", paidOnly: true },
  { key: "compras", label: "Compras", paidOnly: true },
  { key: "contatos", label: "Conversas", paidOnly: true },
  { key: "resultado", label: "Resultado", paidOnly: true },
  { key: "custo", label: "Investimento", paidOnly: true },
  { key: "conversoes", label: "Conversões", paidOnly: true },
];

// Métricas que existem no vocabulário mas que NENHUMA ingestão preenche hoje:
// nem o normalizador da Meta (lib/metaInsights.ts) nem o da Windsor
// (lib/windsor.ts) escrevem estas chaves. Verificado no cache de produção — 376
// linhas em 30 dias, 6 contas, zero ocorrências.
//
// A distinção importa na tela: "0 neste período" e "esta integração não existe"
// são coisas diferentes, e um "—" mudo faz o operador procurar um problema de
// filtro que não está lá. Um KPI destes é mostrado de propósito (o usuário quer
// ver a lacuna de seguidores), mas rotulado como lacuna.
const NEVER_INGESTED = new Set<MetaPostMetricKey>(["profileVisits", "followers", "followersGained"]);

export function isNotIntegrated(ref: MetricRef, customMetrics: CustomMetric[] = []): boolean {
  if (isCustomMetricRef(ref)) {
    const def = customMetrics.find((metric) => `custom:${metric.id}` === ref);
    return Boolean(def) && (NEVER_INGESTED.has(def!.a) || NEVER_INGESTED.has(def!.b));
  }
  return NEVER_INGESTED.has(ref as MetaPostMetricKey);
}

export function metricLabel(key: string): string {
  return DASH_METRICS.find((m) => m.key === key)?.label ?? key;
}

export function sumMetric(posts: MetaPost[], key: MetaPostMetricKey): number {
  let total = 0;
  for (const p of posts) total += p.metrics[key] ?? 0;
  return total;
}

export function hasMetric(posts: MetaPost[], key: MetaPostMetricKey): boolean {
  return posts.some((p) => p.metrics[key] !== undefined);
}

export function aggregateMetric(posts: MetaPost[], key: MetaPostMetricKey): number {
  const impressions = sumMetric(posts, "impressoes");
  const clicks = sumMetric(posts, "cliques");
  const spend = sumMetric(posts, "custo");
  const reach = sumMetric(posts, "alcance");
  if (key === "ctr") return impressions > 0 ? (clicks / impressions) * 100 : 0;
  if (key === "cpc") return clicks > 0 ? spend / clicks : 0;
  if (key === "cpm") return impressions > 0 ? (spend / impressions) * 1000 : 0;
  if (key === "frequencia") return reach > 0 ? impressions / reach : 0;
  return sumMetric(posts, key);
}

// ---- Configurable/custom metrics: one resolution path for built-in and
// custom (metricA op metricB) refs, shared by KPI cards, Tendência, Top
// campanhas and Engajamento so they never diverge in how a value is derived.

export function applyOp(a: number, op: CustomMetricOp, b: number): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "×") return a * b;
  return b !== 0 ? a / b : 0; // divide-by-zero: unavailable, not Infinity/NaN — same "0 when denominator is 0" convention aggregateMetric already uses for ctr/cpc/cpm.
}

function findCustomMetric(ref: MetricRef, customMetrics: CustomMetric[]): CustomMetric | undefined {
  return customMetrics.find((m) => m.id === customMetricIdOf(ref));
}

export function resolveMetricValue(posts: MetaPost[], ref: MetricRef, customMetrics: CustomMetric[]): number {
  if (isCustomMetricRef(ref)) {
    const def = findCustomMetric(ref, customMetrics);
    if (!def) return 0;
    return applyOp(aggregateMetric(posts, def.a), def.op, aggregateMetric(posts, def.b));
  }
  return aggregateMetric(posts, ref);
}

export function metricRefLabel(ref: MetricRef, customMetrics: CustomMetric[]): string {
  if (isCustomMetricRef(ref)) return findCustomMetric(ref, customMetrics)?.label ?? "Métrica removida";
  return metricLabel(ref);
}

// A custom metric is only "available" (vs. rendering "—") when BOTH its
// operands have data in this row set — same spirit as hasMetric for built-ins.
export function metricRefAvailable(posts: MetaPost[], ref: MetricRef, customMetrics: CustomMetric[]): boolean {
  if (isCustomMetricRef(ref)) {
    const def = findCustomMetric(ref, customMetrics);
    return Boolean(def) && hasMetric(posts, def!.a) && hasMetric(posts, def!.b);
  }
  return hasMetric(posts, ref);
}

export function previousPeriod(p: Period): Period {
  const from = new Date(`${p.from}T00:00:00`);
  const to = new Date(`${p.to}T00:00:00`);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), prevTo.getDate() - (days - 1));
  return { from: isoDay(prevFrom), to: isoDay(prevTo) };
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function inPeriod(post: MetaPost, p: Period): boolean {
  return post.date >= p.from && post.date <= p.to;
}

export type PostFilters = {
  platform?: MetaPlatform;
  type?: MetaPost["type"];
  accountId?: string;
};

export function filterPosts(posts: MetaPost[], f: PostFilters): MetaPost[] {
  return posts.filter(
    (p) =>
      (!f.platform || p.platform === f.platform) &&
      (!f.type || p.type === f.type) &&
      (!f.accountId || p.accountId === f.accountId),
  );
}

export type Kpi = { key: MetaPostMetricKey; label: string; value: number; delta: number | null };

export type KpiCard = { metric: MetricRef; label: string; value: number; delta: number | null; available: boolean };

// Headline tiles, one per visible KpiSlot (lib/performancePrefs) — replaces
// the old fixed 3-base+paid/unpaid-4th set with a fully configurable one.
// delta = % change vs the previous period; null when the previous period has
// no data at all (a "+100%" against zero is noise, not signal).
export function kpiSummaryFromSlots(
  posts: MetaPost[],
  prev: MetaPost[],
  slots: { visible: boolean; metric: MetricRef }[],
  customMetrics: CustomMetric[],
): KpiCard[] {
  return slots.filter((s) => s.visible).map((s) => {
    const available = metricRefAvailable(posts, s.metric, customMetrics);
    const value = resolveMetricValue(posts, s.metric, customMetrics);
    const before = resolveMetricValue(prev, s.metric, customMetrics);
    return {
      metric: s.metric,
      label: metricRefLabel(s.metric, customMetrics),
      value,
      delta: before > 0 ? Math.round(((value - before) / before) * 100) : null,
      available,
    };
  });
}

// Daily series for the trend chart, zero-filled so gaps read as real zeros
// instead of the line skipping days. A custom metric is resolved PER DAY
// (sum each operand for that day, then apply the operator) rather than
// applying the operator to the whole-period totals — otherwise a daily CPC
// trend would be flat-wrong (ratios don't distribute over a sum of days).
export function trendSeries(posts: MetaPost[], metric: MetricRef, period: Period, customMetrics: CustomMetric[] = []): { date: string; value: number }[] {
  const days: string[] = [];
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days.push(isoDay(d));

  if (isCustomMetricRef(metric)) {
    const def = findCustomMetric(metric, customMetrics);
    if (!def) return days.map((date) => ({ date, value: 0 }));
    // If an operand is itself a ratio metric (ctr/cpc/cpm/frequencia), this
    // still sums it directly per day instead of recomputing from volume —
    // same class of bug as the built-in branch below, just not fixed here:
    // doing it correctly needs the full 4-component decomposition per
    // operand, which is out of scope for this pass. Documented limitation.
    const byDayA = new Map<string, number>();
    const byDayB = new Map<string, number>();
    for (const p of posts) {
      byDayA.set(p.date, (byDayA.get(p.date) ?? 0) + (p.metrics[def.a] ?? 0));
      byDayB.set(p.date, (byDayB.get(p.date) ?? 0) + (p.metrics[def.b] ?? 0));
    }
    return days.map((date) => ({ date, value: applyOp(byDayA.get(date) ?? 0, def.op, byDayB.get(date) ?? 0) }));
  }

  // Ratio metrics (ctr/cpc/cpm/frequencia) can't be summed per day like a
  // plain count — 3 campaigns each at ctr=2% on the same day would wrongly
  // plot 6%. Sum the underlying volume components for that day instead and
  // derive the ratio afterward, same approach campaignSummaries/adSummaries
  // already use via sumMetricsInto + recomputeRatios.
  if (RATIO_METRIC_KEYS.has(metric as MetaPostMetricKey)) {
    const byDay = new Map<string, Partial<Record<MetaPostMetricKey, number>>>();
    for (const p of posts) {
      const entry = byDay.get(p.date) ?? {};
      sumMetricsInto(entry, p.metrics);
      byDay.set(p.date, entry);
    }
    return days.map((date) => {
      const entry = byDay.get(date);
      if (!entry) return { date, value: 0 };
      recomputeRatios(entry);
      return { date, value: entry[metric as MetaPostMetricKey] ?? 0 };
    });
  }

  const byDay = new Map<string, number>();
  for (const p of posts) byDay.set(p.date, (byDay.get(p.date) ?? 0) + (p.metrics[metric] ?? 0));
  return days.map((date) => ({ date, value: byDay.get(date) ?? 0 }));
}

export function topPosts(posts: MetaPost[], metric: MetaPostMetricKey, n: number, dir: "top" | "bottom"): MetaPost[] {
  const sorted = posts
    .filter((p) => p.source === "organic")
    .slice()
    .sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0));
  return (dir === "top" ? sorted : sorted.reverse()).slice(0, n);
}

// Sums one post's volume metrics into a running total, skipping ratio
// metrics (ctr/cpc/cpm/frequencia) — those are recomputed from the summed
// totals afterward by recomputeRatios, not accumulated directly (averaging
// per-day ratios would weight low-volume days too heavily).
function sumMetricsInto(target: Partial<Record<MetaPostMetricKey, number>>, metrics: MetaPost["metrics"]) {
  for (const [metricKey, value] of Object.entries(metrics) as [MetaPostMetricKey, number | undefined][]) {
    if (value === undefined || metricKey === "ctr" || metricKey === "cpc" || metricKey === "cpm" || metricKey === "frequencia") continue;
    target[metricKey] = (target[metricKey] ?? 0) + value;
  }
}

const RATIO_METRIC_KEYS = new Set<MetaPostMetricKey>(["ctr", "cpc", "cpm", "frequencia"]);

function recomputeRatios(metrics: Partial<Record<MetaPostMetricKey, number>>) {
  const impressions = metrics.impressoes ?? 0;
  const clicks = metrics.cliques ?? 0;
  const spend = metrics.custo ?? 0;
  if (impressions > 0) metrics.ctr = Math.round((clicks / impressions) * 10000) / 100;
  if (clicks > 0) metrics.cpc = Math.round((spend / clicks) * 100) / 100;
  if (impressions > 0) metrics.cpm = Math.round((spend / impressions) * 100000) / 100;
  if ((metrics.alcance ?? 0) > 0) metrics.frequencia = Math.round((impressions / metrics.alcance!) * 100) / 100;
}

export type CampaignSummary = {
  key: string;
  accountId: string;
  accountName: string;
  campaignId: string;
  platform: MetaPost["platform"];
  caption: string;
  metrics: Partial<Record<MetaPostMetricKey, number>>;
  objective?: string;
  currency?: string;
};

// Paid rows are campaign-day rows (one per campaign per day, see lib/meta*
// normalizers), not individual creatives — topPosts deliberately excludes
// them (a campaign total isn't comparable to one post's numbers). This
// aggregates them the other way: one row per campaign for the whole period.
export function campaignSummaries(posts: MetaPost[]): CampaignSummary[] {
  const byKey = new Map<string, CampaignSummary>();
  for (const p of posts) {
    if (p.source !== "paid") continue;
    // MetaPost.id for paid rows is `${accountId}:${campaignId}:${date}`
    // (both lib/windsor.ts and lib/metaInsights.ts follow this convention) —
    // strip the trailing date segment to group a campaign across days.
    const key = `${p.accountId}:${p.campaignId ?? p.caption}:${p.platform}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        accountId: p.accountId,
        accountName: p.accountName,
        campaignId: p.campaignId ?? "",
        platform: p.platform,
        caption: p.caption,
        metrics: {},
        objective: p.objective,
        currency: p.currency,
      };
      byKey.set(key, row);
    }
    sumMetricsInto(row.metrics, p.metrics);
  }
  for (const row of byKey.values()) recomputeRatios(row.metrics);
  return Array.from(byKey.values());
}

// Resolves a metric value from an already-aggregated campaign/ad row's
// summed totals (not raw posts) — reuses the same operator logic as
// resolveMetricValue without re-summing per post.
export function campaignMetricValue(row: { metrics: Partial<Record<MetaPostMetricKey, number>> }, ref: MetricRef, customMetrics: CustomMetric[]): number {
  if (isCustomMetricRef(ref)) {
    const def = findCustomMetric(ref, customMetrics);
    if (!def) return 0;
    return applyOp(row.metrics[def.a] ?? 0, def.op, row.metrics[def.b] ?? 0);
  }
  return row.metrics[ref] ?? 0;
}

export function topCampaigns(posts: MetaPost[], metric: MetricRef, n: number, customMetrics: CustomMetric[] = []): CampaignSummary[] {
  return campaignSummaries(posts)
    .sort((a, b) => campaignMetricValue(b, metric, customMetrics) - campaignMetricValue(a, metric, customMetrics))
    .slice(0, n);
}

export function sortCampaigns(rows: CampaignSummary[], key: MetaPostMetricKey, dir: SortDir): CampaignSummary[] {
  const sorted = rows.slice().sort((a, b) => (a.metrics[key] ?? 0) - (b.metrics[key] ?? 0));
  return dir === "asc" ? sorted : sorted.reverse();
}

export type AdSummary = {
  key: string;
  adId: string;
  adName: string;
  thumbnailUrl: string | null;
  platform: MetaPost["platform"];
  metrics: Partial<Record<MetaPostMetricKey, number>>;
  currency?: string;
};

// Same shape as campaignSummaries, one row per ad instead of per campaign —
// used for the ad-level drill-down under an expanded campaign row.
export function adSummaries(posts: MetaPost[]): AdSummary[] {
  const byKey = new Map<string, AdSummary>();
  for (const p of posts) {
    if (p.source !== "paid" || !p.adId) continue;
    const key = `${p.adId}:${p.platform}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        adId: p.adId,
        adName: p.adName || p.caption,
        thumbnailUrl: p.thumbnailUrl ?? null,
        platform: p.platform,
        metrics: {},
        currency: p.currency,
      };
      byKey.set(key, row);
    }
    sumMetricsInto(row.metrics, p.metrics);
  }
  for (const row of byKey.values()) recomputeRatios(row.metrics);
  return Array.from(byKey.values()).sort((a, b) => (b.metrics.custo ?? 0) - (a.metrics.custo ?? 0));
}

export type PerformanceEntitySummary = {
  key: string;
  id: string;
  name: string;
  level: "adset" | "ad";
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  adsetId?: string;
  adsetName?: string;
  platform: MetaPost["platform"];
  thumbnailUrl: string | null;
  objective?: string;
  currency?: string;
  metrics: Partial<Record<MetaPostMetricKey, number>>;
};

export function performanceEntitySummaries(posts: MetaPost[], level: "adset" | "ad"): PerformanceEntitySummary[] {
  const byKey = new Map<string, PerformanceEntitySummary>();
  for (const post of posts) {
    if (post.source !== "paid") continue;
    const id = level === "adset" ? post.adsetId : post.adId;
    if (!id) continue;
    const key = `${post.accountId}:${id}:${post.platform}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key, id, level, accountId: post.accountId, accountName: post.accountName,
        campaignId: post.campaignId ?? "", campaignName: post.campaignName ?? post.campaignId ?? "—",
        adsetId: post.adsetId, adsetName: post.adsetName,
        name: level === "adset" ? post.adsetName ?? post.caption : post.adName ?? post.caption,
        platform: post.platform, thumbnailUrl: post.thumbnailUrl ?? null,
        objective: post.objective, currency: post.currency, metrics: {},
      };
      byKey.set(key, row);
    }
    sumMetricsInto(row.metrics, post.metrics);
  }
  for (const row of byKey.values()) recomputeRatios(row.metrics);
  return [...byKey.values()].sort((a, b) => (b.metrics.custo ?? 0) - (a.metrics.custo ?? 0));
}

export type MixSlice = { key: MetricRef; label: string; value: number };

const MIX_DEFAULT: [MetricRef, MetricRef, MetricRef, MetricRef] = ["likes", "comentarios", "compartilhamentos", "salvos"];

export function engagementMix(posts: MetaPost[], refs: [MetricRef, MetricRef, MetricRef, MetricRef] = MIX_DEFAULT, customMetrics: CustomMetric[] = []): MixSlice[] {
  return refs
    .map((ref) => ({ key: ref, label: metricRefLabel(ref, customMetrics), value: resolveMetricValue(posts, ref, customMetrics) }))
    .filter((s) => s.value > 0);
}

// MetaPost -> task_metrics values keyed by METRIC_DEFS (app/admin/metricDefs.ts).
// "agendamentos" is deliberately absent — it's the manual-only business metric
// and a sync must never overwrite it.
export function postToTaskMetrics(post: MetaPost): Record<string, string> {
  const m = post.metrics;
  const out: Record<string, string> = {};
  const put = (key: string, value: number | undefined) => {
    if (value !== undefined) out[key] = String(value);
  };
  put("alcance", m.alcance);
  put("impressoes", m.impressoes);
  put("cliques", m.cliques);
  put("ctr", m.ctr);
  put("engajamento", m.engajamento);
  put("custo", m.custo);
  put("cpc", m.cpc);
  put("conversoes", m.conversoes);
  return out;
}

// pt-BR compact number for KPI tiles/chart labels: 12.400 -> "12,4 mil".
export function fmtCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
