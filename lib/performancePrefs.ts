import type { MetaPostMetricKey } from "./windsor";

// Shared, agency-wide view preferences for the Performance > Anúncios
// "Campanhas" table (which metric columns show, sort order, default period).
// Pure/DB-free so it can be imported by both the client dashboard and
// lib/supabase.ts's persistence layer without pulling either into the other.

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
  { key: "mensagens", label: "Conversas" },
  { key: "leads", label: "Leads" },
  { key: "compras", label: "Compras" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "custo", label: "Investimento" },
];

const VALID_COLUMN_KEYS = new Set(CAMPAIGN_METRIC_COLUMNS.map((c) => c.key));
const VALID_PERIODS = new Set<PeriodPreset>([7, 30, 90]);

export type PerformanceViewPrefs = {
  visibleColumns: MetaPostMetricKey[];
  sortKey: MetaPostMetricKey;
  sortDir: SortDir;
  defaultPeriod: PeriodPreset;
};

export const PERFORMANCE_VIEW_PREFS_DEFAULT: PerformanceViewPrefs = {
  visibleColumns: CAMPAIGN_METRIC_COLUMNS.map((c) => c.key),
  sortKey: "custo",
  sortDir: "desc",
  defaultPeriod: 30,
};

// Whitelist-validates whatever came back from site_settings/the client —
// unknown or removed metric keys are dropped instead of surfacing a broken
// column, and an empty result falls back to the full default set.
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
  return {
    visibleColumns: visibleColumns.length ? visibleColumns : PERFORMANCE_VIEW_PREFS_DEFAULT.visibleColumns,
    sortKey,
    sortDir,
    defaultPeriod,
  };
}
