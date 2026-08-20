import { DASH_METRICS, fmtCompact, hasMetric, metricRefAvailable } from "./insights";
import { isCustomMetricRef, type CustomMetric, type MetricRef } from "@/lib/performancePrefs";
import type { MetaPlatform, MetaPost, MetaPostMetricKey } from "@/lib/windsor";

// Shared label/format helpers pulled out of PerformanceDashboard.tsx so the
// composite filter, the shared bottom table, and the generalized Aquisição
// cards can all reference the same vocabulary instead of three copies.

export const PLATFORM_LABEL: Record<MetaPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  audience_network: "Audience Network",
  unknown: "Outras redes",
};

export const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_LEADS: "Leads",
  OUTCOME_SALES: "Vendas",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_APP_PROMOTION: "Aplicativo",
};

// Ratio metrics render with a different unit than the plain-count default.
export const COLUMN_KIND: Partial<Record<MetaPostMetricKey, "money" | "percent" | "decimal">> = {
  frequencia: "decimal",
  ctr: "percent",
  cpc: "money",
  cpm: "money",
  custo: "money",
};

export function platformTone(platform: MetaPlatform): string {
  if (platform === "instagram") return "t-tone-purple";
  if (platform === "facebook") return "t-tone-blue";
  return "t-tone-green";
}

export function metricValue(value: number | undefined, kind: "number" | "money" | "percent" | "decimal" = "number", currency = "BRL") {
  if (value === undefined) return "—";
  if (kind === "percent") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (kind === "decimal") return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "money") {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `R$ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
    }
  }
  return fmtCompact(value);
}

export function csvCell(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Shared between PerformanceDashboard.tsx and AcquisitionDashboard.tsx —
// both now let the user swap/hide per-card metrics against the same
// built-in + custom-metric vocabulary.
export function metricRefKind(ref: MetricRef, customMetrics: CustomMetric[]): "number" | "money" | "percent" | "decimal" {
  if (isCustomMetricRef(ref)) return customMetrics.find((metric) => `custom:${metric.id}` === ref)?.format ?? "number";
  return COLUMN_KIND[ref] ?? "number";
}

export function metricRefOptions(posts: MetaPost[], customMetrics: CustomMetric[]): { ref: MetricRef; label: string }[] {
  const built = DASH_METRICS.filter((m) => hasMetric(posts, m.key)).map((m) => ({ ref: m.key as MetricRef, label: m.label }));
  const customs = customMetrics
    .filter((m) => metricRefAvailable(posts, `custom:${m.id}`, customMetrics))
    .map((m) => ({ ref: `custom:${m.id}` as MetricRef, label: m.label }));
  return [...built, ...customs];
}

// Toggleable card sections per screen — the single toolbar-level "eye"
// dropdown (PerformanceToolbar) lists these for whichever screen is active;
// each dashboard also reads this same list to decide what to render.
// "futuramente colocaremos mais" (user) — extend these arrays, nothing else
// needs to change for a new toggleable section to show up in the dropdown.
export type PerfSection = { key: string; label: string };
export const ANALYTICS_SECTIONS: PerfSection[] = [
  { key: "kpis", label: "KPIs" },
  { key: "trend", label: "Tendência diária" },
  { key: "topCampaigns", label: "Top campanhas" },
  { key: "mix", label: "Engajamento dos anúncios" },
];
export const ACQUISITION_SECTIONS: PerfSection[] = [
  { key: "kpis", label: "KPIs" },
  { key: "funnel", label: "Funil de aquisição" },
  { key: "trend", label: "Evolução" },
  { key: "volume", label: "Volume" },
  { key: "gauges", label: "Eficiência de mídia" },
];

// Cost-shaped metrics where a lower value is the good direction — used by
// Aquisição's generalized KPI/gauge cards to pick Delta's up/down coloring
// without hardcoding which slot holds a cost. Heuristic for custom metrics:
// "custo ÷ X" (any X) reads as a cost-per-X, same shape as the built-in
// cost/cpc/cpm metrics.
export function metricRefInverse(ref: MetricRef, customMetrics: CustomMetric[]): boolean {
  if (isCustomMetricRef(ref)) {
    const def = customMetrics.find((metric) => `custom:${metric.id}` === ref);
    return Boolean(def && def.op === "÷" && def.a === "custo");
  }
  return ref === "custo" || ref === "cpc" || ref === "cpm";
}
