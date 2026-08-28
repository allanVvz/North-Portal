import type { MetaPostMetricKey } from "./windsor";

// Shared, agency-wide view preferences for the Performance dashboard (KPI
// cards, chart metrics, custom metrics, and the "Campanhas" table columns/
// sort/period). Pure/DB-free so it can be imported by both the client
// dashboard and lib/supabase.ts's persistence layer without pulling either
// into the other.

export type SortDir = "asc" | "desc";
export type PeriodPreset = 7 | 30 | 90;

// The identity columns (Plataforma/Conta/Campanha/Objetivo) always render —
// only the metric columns are configurable/sortable.
export const CAMPAIGN_METRIC_COLUMNS: { key: MetaPostMetricKey; label: string }[] = [
  { key: "alcance", label: "Alcance" },
  { key: "impressoes", label: "Impressões" },
  { key: "frequencia", label: "Frequência" },
  { key: "engajamento", label: "Engajamento" },
  { key: "likes", label: "Reações" },
  { key: "comentarios", label: "Comentários" },
  { key: "compartilhamentos", label: "Compart." },
  { key: "salvos", label: "Salvos" },
  { key: "videoViews", label: "Views vídeo" },
  { key: "cliquesLink", label: "Cliques link" },
  { key: "landingPageViews", label: "Visitas página" },
  { key: "profileVisits", label: "Visitas ao perfil" },
  { key: "followersGained", label: "Novos seguidores" },
  { key: "mensagens", label: "Conversas" },
  { key: "leads", label: "Leads" },
  { key: "compras", label: "Compras" },
  { key: "contatos", label: "Conversas" },
  { key: "resultado", label: "Resultado" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "custo", label: "Investimento" },
];

// Every metric field the Meta/Windsor pipeline can produce — the whitelist
// custom-metric operands and metric references are validated against. Wider
// than CAMPAIGN_METRIC_COLUMNS (which is only the table's curated column
// list) on purpose: a custom metric operand doesn't need to already be a
// table column.
const ALL_METRIC_KEYS: MetaPostMetricKey[] = [
  "alcance", "impressoes", "likes", "comentarios", "compartilhamentos",
  "salvos", "engajamento", "videoViews", "cliques", "ctr", "custo",
  "cpc", "cpm", "frequencia", "cliquesUnicos", "cliquesLink",
  "landingPageViews", "leads", "compras", "mensagens", "conversoes",
  "profileVisits", "followers", "followersGained", "resultado", "contatos",
];
const VALID_METRIC_KEYS = new Set(ALL_METRIC_KEYS);
const VALID_COLUMN_KEYS = new Set(CAMPAIGN_METRIC_COLUMNS.map((c) => c.key));
const VALID_PERIODS = new Set<PeriodPreset>([7, 30, 90]);

// ---- Configurable metrics (KPI cards + Tendência/Top campanhas/Engajamento) ----

export type CustomMetricOp = "+" | "-" | "×" | "÷";
export type CustomMetricFormat = "number" | "money" | "percent";
export type CustomMetric = {
  id: string;
  label: string;
  a: MetaPostMetricKey;
  b: MetaPostMetricKey;
  op: CustomMetricOp;
  format?: CustomMetricFormat;
};
// A built-in metric key, or a reference to one of PerformanceViewPrefs's own
// customMetrics by id. Operands of a CustomMetric are always built-in keys —
// no metric-referencing-metric, so no cycle detection needed.
export type MetricRef = MetaPostMetricKey | `custom:${string}`;
export type KpiSlot = { visible: boolean; metric: MetricRef };

export function isCustomMetricRef(ref: MetricRef): ref is `custom:${string}` {
  return ref.startsWith("custom:");
}
export function customMetricIdOf(ref: MetricRef): string {
  return ref.startsWith("custom:") ? ref.slice(7) : ref;
}

// Exported for lib/acquisitionPrefs.ts, which needs the same built-in/custom
// MetricRef whitelist check for its own slot arrays.
export function isValidMetricRef(ref: unknown, customIds: Set<string>): ref is MetricRef {
  if (typeof ref !== "string") return false;
  if (ref.startsWith("custom:")) return customIds.has(ref.slice(7));
  return VALID_METRIC_KEYS.has(ref as MetaPostMetricKey);
}

// Reproduces today's fixed KPI set (before this became configurable) as the
// default, so anyone who never customizes sees exactly what they saw before.
const DEFAULT_KPI_METRICS: MetaPostMetricKey[] = [
  "alcance", "impressoes", "engajamento", "likes", "comentarios", "cliquesLink", "mensagens", "custo",
];

export type PerformanceViewPrefs = {
  visibleColumns: MetaPostMetricKey[];
  sortKey: MetaPostMetricKey;
  sortDir: SortDir;
  defaultPeriod: PeriodPreset;
  kpiSlots: KpiSlot[];
  trendMetric: MetricRef;
  topCampaignsMetric: MetricRef;
  mixMetric: [MetricRef, MetricRef, MetricRef, MetricRef];
  customMetrics: CustomMetric[];
};

export const PERFORMANCE_VIEW_PREFS_DEFAULT: PerformanceViewPrefs = {
  visibleColumns: CAMPAIGN_METRIC_COLUMNS.map((c) => c.key),
  sortKey: "custo",
  sortDir: "desc",
  defaultPeriod: 30,
  kpiSlots: DEFAULT_KPI_METRICS.map((metric) => ({ visible: true, metric })),
  trendMetric: "engajamento",
  topCampaignsMetric: "engajamento",
  mixMetric: ["likes", "comentarios", "compartilhamentos", "salvos"],
  customMetrics: [],
};

// Whitelist-validates whatever came back from site_settings/the client —
// unknown or removed metric keys are dropped instead of surfacing a broken
// column, and an empty result falls back to the full default set. Order
// matters: customMetrics is sanitized first so kpiSlots/trendMetric/etc can
// validate their MetricRefs (which may point at a custom metric id) against it.
export function sanitizePerformanceViewPrefs(raw: unknown): PerformanceViewPrefs {
  const value = (raw ?? {}) as Partial<PerformanceViewPrefs>;
  const visibleColumns = Array.isArray(value.visibleColumns)
    ? value.visibleColumns.filter((k): k is MetaPostMetricKey => VALID_COLUMN_KEYS.has(k as MetaPostMetricKey))
    : [];
  const sortKey = VALID_COLUMN_KEYS.has(value.sortKey as MetaPostMetricKey)
    ? (value.sortKey as MetaPostMetricKey)
    : PERFORMANCE_VIEW_PREFS_DEFAULT.sortKey;
  const sortDir: SortDir = value.sortDir === "asc" ? "asc" : "desc";
  const defaultPeriod = VALID_PERIODS.has(value.defaultPeriod as PeriodPreset)
    ? (value.defaultPeriod as PeriodPreset)
    : PERFORMANCE_VIEW_PREFS_DEFAULT.defaultPeriod;

  const customMetrics = Array.isArray(value.customMetrics)
    ? value.customMetrics.filter((m): m is CustomMetric =>
        Boolean(m) && typeof m === "object"
        && typeof m.id === "string" && m.id.length > 0
        && typeof m.label === "string" && m.label.trim().length > 0 && m.label.length <= 60
        && VALID_METRIC_KEYS.has(m.a as MetaPostMetricKey)
        && VALID_METRIC_KEYS.has(m.b as MetaPostMetricKey)
        && (["+", "-", "×", "÷"] as CustomMetricOp[]).includes(m.op as CustomMetricOp)
        && (m.format === undefined || (["number", "money", "percent"] as CustomMetricFormat[]).includes(m.format)))
    : [];
  const customIds = new Set(customMetrics.map((m) => m.id));

  const kpiSlots = Array.isArray(value.kpiSlots)
    ? value.kpiSlots.filter((s): s is KpiSlot =>
        Boolean(s) && typeof s === "object" && typeof s.visible === "boolean" && isValidMetricRef(s.metric, customIds))
    : [];

  const trendMetric = isValidMetricRef(value.trendMetric, customIds) ? value.trendMetric : PERFORMANCE_VIEW_PREFS_DEFAULT.trendMetric;
  const topCampaignsMetric = isValidMetricRef(value.topCampaignsMetric, customIds) ? value.topCampaignsMetric : PERFORMANCE_VIEW_PREFS_DEFAULT.topCampaignsMetric;
  const rawMix = Array.isArray(value.mixMetric) ? value.mixMetric : [];
  const mixMetric: [MetricRef, MetricRef, MetricRef, MetricRef] = [0, 1, 2, 3].map((i) =>
    isValidMetricRef(rawMix[i], customIds) ? (rawMix[i] as MetricRef) : PERFORMANCE_VIEW_PREFS_DEFAULT.mixMetric[i],
  ) as [MetricRef, MetricRef, MetricRef, MetricRef];

  return {
    visibleColumns: visibleColumns.length ? visibleColumns : PERFORMANCE_VIEW_PREFS_DEFAULT.visibleColumns,
    sortKey,
    sortDir,
    defaultPeriod,
    kpiSlots: kpiSlots.length ? kpiSlots : PERFORMANCE_VIEW_PREFS_DEFAULT.kpiSlots,
    trendMetric,
    topCampaignsMetric,
    mixMetric,
    customMetrics,
  };
}
