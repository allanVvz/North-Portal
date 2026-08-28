import { isValidMetricRef, type CustomMetric, type MetricRef } from "./performancePrefs";

// Shared, agency-wide view preferences for the Aquisição dashboard — same
// additive/whitelisted-sanitizer spirit as performancePrefs.ts, so a
// template can drive Aquisição's cards the same way it already drives
// Analytics'. Kept as its own module (not folded into PerformanceViewPrefs)
// because Aquisição's cards are structurally different (gauges, a funnel,
// a message-intent branch) rather than a generic KPI grid.
//
// clickToMessageRate (the message branch) is deliberately NOT a swappable
// slot: it has its own link-vs-total-click fallback semantics
// (acquisitionInsights.ts's messageClickBasis) documented in
// plan/PERFORMANCE-AQUISICAO.md ("a taxa prioriza cliques no link e nunca é
// calculada como Leads → Mensagens") that a generic metric-pair ratio can't
// safely reproduce for an arbitrary swapped-in pair — it only gets a
// visibility toggle. Aquisição's "Taxa de conversão" volume tile is the
// same story: it's leads÷cliques×100, and MetricRef's custom-metric
// operators (+,-,×,÷) have no built-in "×100", so it stays a fixed display
// alongside the swappable volume slots rather than becoming one.

export type AcquisitionViewPrefs = {
  kpiSlots: MetricRef[];
  volumeSlots: MetricRef[];
  gaugeSlots: MetricRef[];
  funnelStages: MetricRef[];
  showMessageBranch: boolean;
  trendMetrics: MetricRef[];
};

export const ACQUISITION_VIEW_PREFS_DEFAULT: AcquisitionViewPrefs = {
  // Só refs built-in: este default é usado antes de qualquer template ser
  // aplicado, e um `custom:` aqui dependeria de um template definir aquela
  // métrica. Quando não define, metricRefLabel() renderiza o card como
  // "Métrica removida" — foi o que aconteceu quando os builtins que traziam
  // `native_cost_per_lead` saíram.
  kpiSlots: ["custo", "alcance", "contatos"],
  volumeSlots: ["impressoes", "cliques"],
  gaugeSlots: ["cpm", "cpc", "ctr"],
  funnelStages: ["alcance", "cliquesLink", "contatos"],
  showMessageBranch: false,
  trendMetrics: ["custo", "contatos"],
};

const MAX_SLOTS = 6;
const MAX_FUNNEL_STAGES = 3;
const MIN_FUNNEL_STAGES = 2;
const MAX_TREND_METRICS = 2;

function sanitizeMetricRefList(raw: unknown, customIds: Set<string>, max: number): MetricRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MetricRef[] = [];
  for (const item of raw) {
    if (!isValidMetricRef(item, customIds) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

// customMetrics comes from the same template's Analytics prefs — Aquisição
// doesn't have its own separate custom-metric list, it reuses the shared
// agency-wide set (e.g. "Custo por lead") so a slot referencing
// `custom:native_cost_per_lead` resolves the same way on both screens.
export function sanitizeAcquisitionViewPrefs(raw: unknown, customMetrics: CustomMetric[] = []): AcquisitionViewPrefs {
  const value = (raw ?? {}) as Partial<AcquisitionViewPrefs>;
  const customIds = new Set(customMetrics.map((metric) => metric.id));

  const kpiSlots = sanitizeMetricRefList(value.kpiSlots, customIds, MAX_SLOTS);
  const volumeSlots = sanitizeMetricRefList(value.volumeSlots, customIds, MAX_SLOTS);
  const gaugeSlots = sanitizeMetricRefList(value.gaugeSlots, customIds, MAX_SLOTS);
  const funnelStages = sanitizeMetricRefList(value.funnelStages, customIds, MAX_FUNNEL_STAGES);
  const trendMetrics = sanitizeMetricRefList(value.trendMetrics, customIds, MAX_TREND_METRICS);

  return {
    kpiSlots: kpiSlots.length ? kpiSlots : ACQUISITION_VIEW_PREFS_DEFAULT.kpiSlots,
    volumeSlots: volumeSlots.length ? volumeSlots : ACQUISITION_VIEW_PREFS_DEFAULT.volumeSlots,
    gaugeSlots: gaugeSlots.length ? gaugeSlots : ACQUISITION_VIEW_PREFS_DEFAULT.gaugeSlots,
    funnelStages: funnelStages.length >= MIN_FUNNEL_STAGES ? funnelStages : ACQUISITION_VIEW_PREFS_DEFAULT.funnelStages,
    showMessageBranch: typeof value.showMessageBranch === "boolean" ? value.showMessageBranch : ACQUISITION_VIEW_PREFS_DEFAULT.showMessageBranch,
    trendMetrics: trendMetrics.length ? trendMetrics : ACQUISITION_VIEW_PREFS_DEFAULT.trendMetrics,
  };
}
