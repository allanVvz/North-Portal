import {
  ACQUISITION_VIEW_PREFS_DEFAULT,
  sanitizeAcquisitionViewPrefs,
  type AcquisitionViewPrefs,
} from "./acquisitionPrefs";
import {
  PERFORMANCE_VIEW_PREFS_DEFAULT,
  sanitizePerformanceViewPrefs,
  type MetricRef,
  type PerformanceViewPrefs,
} from "./performancePrefs";
import type { MetaPlatform } from "./windsor";

export type PerformanceEntityLevel = "campaign" | "adset" | "ad";
export type PerformanceTemplateScope = "builtin" | "personal" | "agency";
export type PerformanceTemplateFilters = {
  clientSlug: string;
  category: "ads" | "organico" | "ambos";
  platforms: MetaPlatform[];
  objectives: string[];
};
export type PerformanceTemplateConfig = {
  version: 1;
  prefs: PerformanceViewPrefs;
  // Aquisição's own configurable slots (Parte 5a) — additive field, so
  // templates saved before this shipped sanitize cleanly to the default.
  acquisition: AcquisitionViewPrefs;
  filters: PerformanceTemplateFilters;
  dateRange: { from: string; to: string } | null;
  cardSources: Record<string, "paid" | "organic">;
  level: PerformanceEntityLevel;
  selectedCampaignIds: string[];
  selectedAdsetIds: string[];
  selectedAdIds: string[];
  trendMetrics: MetricRef[];
};
export type PerformanceTemplate = {
  id: string;
  name: string;
  description: string;
  scope: PerformanceTemplateScope;
  ownerProfileId: string | null;
  config: PerformanceTemplateConfig;
  updatedAt: string | null;
};

const PLATFORMS = new Set<MetaPlatform>(["instagram", "facebook", "whatsapp", "messenger", "audience_network", "unknown"]);
const LEVELS = new Set<PerformanceEntityLevel>(["campaign", "adset", "ad"]);
function stringList(raw: unknown, max = 100): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200))].slice(0, max);
}

function sanitizeDateRange(raw: unknown): { from: string; to: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { from?: unknown; to?: unknown };
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof value.from !== "string" || typeof value.to !== "string" || !valid.test(value.from) || !valid.test(value.to) || value.from > value.to) return null;
  return { from: value.from, to: value.to };
}

function sanitizeCardSources(raw: unknown): Record<string, "paid" | "organic"> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter(([key, source]) => key.length > 0 && key.length <= 120 && (source === "paid" || source === "organic"))
    .slice(0, 100)) as Record<string, "paid" | "organic">;
}

export function sanitizePerformanceTemplateConfig(raw: unknown): PerformanceTemplateConfig {
  const value = (raw ?? {}) as Partial<PerformanceTemplateConfig>;
  const filters = (value.filters ?? {}) as Partial<PerformanceTemplateFilters>;
  const prefs = sanitizePerformanceViewPrefs(value.prefs);
  const acquisition = sanitizeAcquisitionViewPrefs(value.acquisition, prefs.customMetrics);
  const customRefs = new Set(prefs.customMetrics.map((metric) => `custom:${metric.id}`));
  const trendMetrics = stringList(value.trendMetrics, 3).filter((metric): metric is MetricRef => {
    if (metric.startsWith("custom:")) return customRefs.has(metric);
    return sanitizePerformanceViewPrefs({ ...prefs, trendMetric: metric }).trendMetric === metric;
  });
  return {
    version: 1,
    prefs,
    acquisition,
    filters: {
      // Templates são compartilhados pela agência. Cliente é sempre um
      // contexto local da consulta e nunca pode vazar para a configuração.
      clientSlug: "",
      category: filters.category === "organico" || filters.category === "ambos" ? filters.category : "ads",
      platforms: stringList(filters.platforms, 6).filter((p): p is MetaPlatform => PLATFORMS.has(p as MetaPlatform)),
      objectives: stringList(filters.objectives, 20),
    },
    dateRange: sanitizeDateRange(value.dateRange),
    cardSources: sanitizeCardSources(value.cardSources),
    level: LEVELS.has(value.level as PerformanceEntityLevel) ? value.level as PerformanceEntityLevel : "campaign",
    selectedCampaignIds: stringList(value.selectedCampaignIds),
    selectedAdsetIds: stringList(value.selectedAdsetIds),
    selectedAdIds: stringList(value.selectedAdIds),
    trendMetrics: trendMetrics.length ? trendMetrics : [prefs.trendMetric],
  };
}

const COST_PER_MESSAGE_ID = "native_cost_per_message";
const COST_PER_FOLLOWER_ID = "native_cost_per_follower";
const COST_PER_LEAD_ID = "native_cost_per_lead";
const costPerLeadMetric = { id: COST_PER_LEAD_ID, label: "Custo por lead", a: "custo" as const, b: "leads" as const, op: "÷" as const, format: "money" as const };
const costPerMessageMetric = { id: COST_PER_MESSAGE_ID, label: "Custo por conversa", a: "custo" as const, b: "mensagens" as const, op: "÷" as const, format: "money" as const };

// 3 builtins organized by funnel stage (topo/fundo/completo), replacing the
// previous "Crescimento do perfil"/"Conversas no WhatsApp" pair — both had
// drifted into mixing top-of-funnel and bottom-of-funnel metrics together
// (e.g. WhatsApp mixed in alcance; profile-growth locked to Instagram-only
// and pulled in mensagens). Each template now also carries an `acquisition`
// slice (Parte 5a) so picking a template changes both screens' cards.
const topFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["alcance", "impressoes", "cpm", "frequencia", "profileVisits", "followersGained"].map((metric) => ({ visible: true, metric })),
  trendMetric: "alcance",
  topCampaignsMetric: "alcance",
  visibleColumns: ["alcance", "impressoes", "frequencia", "profileVisits", "followersGained", "ctr", "cpm"],
  customMetrics: [],
});
const bottomFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["custo", "cliquesLink", "leads", `custom:${COST_PER_LEAD_ID}`, "mensagens", `custom:${COST_PER_MESSAGE_ID}`].map((metric) => ({ visible: true, metric })),
  trendMetric: "leads",
  topCampaignsMetric: `custom:${COST_PER_LEAD_ID}`,
  visibleColumns: ["custo", "cliquesLink", "leads", "mensagens", "ctr", "cpc", "cpm"],
  customMetrics: [costPerLeadMetric, costPerMessageMetric],
});
const fullFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["alcance", "impressoes", "cliquesLink", "leads", "custo", `custom:${COST_PER_LEAD_ID}`].map((metric) => ({ visible: true, metric })),
  trendMetric: "alcance",
  topCampaignsMetric: "leads",
  visibleColumns: ["alcance", "impressoes", "cliquesLink", "leads", "custo", "ctr", "cpc", "cpm"],
  customMetrics: [costPerLeadMetric],
});

const topFunnelAcquisition: AcquisitionViewPrefs = {
  kpiSlots: ["alcance", "impressoes", "custo"],
  volumeSlots: ["impressoes", "cliques"],
  gaugeSlots: ["cpm", "ctr", "frequencia"],
  funnelStages: ["alcance", "impressoes", "cliques"],
  showMessageBranch: false,
  trendMetrics: ["alcance", "impressoes"],
};

export const BUILTIN_PERFORMANCE_TEMPLATES: PerformanceTemplate[] = [
  {
    id: "builtin-full-funnel", name: "Funil completo",
    description: "Alcance, cliques, leads e investimento — visão de ponta a ponta.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: fullFunnelPrefs, acquisition: ACQUISITION_VIEW_PREFS_DEFAULT, filters: { clientSlug: "", category: "ads", platforms: [], objectives: [] }, level: "campaign", trendMetrics: ["alcance", "leads"] }),
  },
  {
    id: "builtin-top-funnel", name: "Topo de funil",
    description: "Alcance, impressões e frequência — reconhecimento e engajamento.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: topFunnelPrefs, acquisition: topFunnelAcquisition, filters: { clientSlug: "", category: "ads", platforms: [], objectives: ["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT"] }, level: "campaign", trendMetrics: ["alcance", "impressoes"] }),
  },
  {
    id: "builtin-bottom-funnel", name: "Fundo de funil",
    description: "Leads, custo por lead e conversas — conversão e intenção de compra.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: bottomFunnelPrefs, acquisition: ACQUISITION_VIEW_PREFS_DEFAULT, filters: { clientSlug: "", category: "ads", platforms: [], objectives: ["OUTCOME_LEADS", "OUTCOME_SALES"] }, level: "campaign", trendMetrics: ["leads", "custo"] }),
  },
];
