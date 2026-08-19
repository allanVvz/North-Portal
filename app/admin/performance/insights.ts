import type { SortDir } from "@/lib/performancePrefs";
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
  { key: "mensagens", label: "Conversas iniciadas", paidOnly: true },
  { key: "leads", label: "Leads", paidOnly: true },
  { key: "compras", label: "Compras", paidOnly: true },
  { key: "custo", label: "Investimento", paidOnly: true },
  { key: "conversoes", label: "Conversões", paidOnly: true },
];

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

// Headline tiles: 3 organic KPIs + (paid ? custo/cpc : média de engajamento).
// delta = % change vs the previous period; null when the previous period has
// no data at all (a "+100%" against zero is noise, not signal).
export function kpiSummary(posts: MetaPost[], prev: MetaPost[], paid: boolean): Kpi[] {
  const mk = (key: MetaPostMetricKey, label: string): Kpi => {
    const value = aggregateMetric(posts, key);
    const before = aggregateMetric(prev, key);
    return { key, label, value, delta: before > 0 ? Math.round(((value - before) / before) * 100) : null };
  };
  const kpis = [mk("alcance", "Alcance"), mk("impressoes", "Impressões"), mk("engajamento", "Engajamento")];
  if (paid) kpis.push(
    mk("likes", "Reações"),
    mk("comentarios", "Comentários"),
    mk("cliquesLink", "Cliques no link"),
    mk("mensagens", "Conversas iniciadas"),
    mk("custo", "Investimento"),
  );
  else kpis.push(mk("videoViews", "Views de vídeo"));
  return kpis;
}

// Daily series for the trend chart, zero-filled so gaps read as real zeros
// instead of the line skipping days.
export function trendSeries(posts: MetaPost[], metric: MetaPostMetricKey, period: Period): { date: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const p of posts) byDay.set(p.date, (byDay.get(p.date) ?? 0) + (p.metrics[metric] ?? 0));
  const out: { date: string; value: number }[] = [];
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = isoDay(d);
    out.push({ date: key, value: byDay.get(key) ?? 0 });
  }
  return out;
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

export function topCampaigns(posts: MetaPost[], metric: MetaPostMetricKey, n: number): CampaignSummary[] {
  return campaignSummaries(posts)
    .sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0))
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

export type MixSlice = { key: "likes" | "comentarios" | "compartilhamentos" | "salvos"; label: string; value: number };

export function engagementMix(posts: MetaPost[]): MixSlice[] {
  return [
    { key: "likes" as const, label: "Curtidas", value: sumMetric(posts, "likes") },
    { key: "comentarios" as const, label: "Comentários", value: sumMetric(posts, "comentarios") },
    { key: "compartilhamentos" as const, label: "Compartilhamentos", value: sumMetric(posts, "compartilhamentos") },
    { key: "salvos" as const, label: "Salvos", value: sumMetric(posts, "salvos") },
  ].filter((s) => s.value > 0);
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
