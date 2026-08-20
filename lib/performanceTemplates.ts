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
  const customRefs = new Set(prefs.customMetrics.map((metric) => `custom:${metric.id}`));
  const trendMetrics = stringList(value.trendMetrics, 3).filter((metric): metric is MetricRef => {
    if (metric.startsWith("custom:")) return customRefs.has(metric);
    return sanitizePerformanceViewPrefs({ ...prefs, trendMetric: metric }).trendMetric === metric;
  });
  return {
    version: 1,
    prefs,
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
const growthPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["custo", "profileVisits", "cliquesLink", "followersGained", `custom:${COST_PER_FOLLOWER_ID}`, "mensagens"].map((metric) => ({ visible: true, metric })),
  trendMetric: "followersGained",
  topCampaignsMetric: `custom:${COST_PER_FOLLOWER_ID}`,
  visibleColumns: ["custo", "profileVisits", "cliquesLink", "followersGained", "mensagens", "ctr", "cpc", "frequencia"],
  customMetrics: [{ id: COST_PER_FOLLOWER_ID, label: "Custo por seguidor", a: "custo", b: "followersGained", op: "÷", format: "money" }],
});
const whatsappPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["custo", "alcance", "mensagens", `custom:${COST_PER_MESSAGE_ID}`, "profileVisits", "followersGained"].map((metric) => ({ visible: true, metric })),
  trendMetric: "custo",
  topCampaignsMetric: `custom:${COST_PER_MESSAGE_ID}`,
  visibleColumns: ["custo", "alcance", "mensagens", "profileVisits", "followersGained", "ctr", "cpc"],
  customMetrics: [{ id: COST_PER_MESSAGE_ID, label: "Custo por conversa", a: "custo", b: "mensagens", op: "÷", format: "money" }],
});

export const BUILTIN_PERFORMANCE_TEMPLATES: PerformanceTemplate[] = [
  {
    id: "builtin-profile-growth", name: "Crescimento do perfil",
    description: "Investimento, visitas, cliques e aquisição de seguidores.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: growthPrefs, filters: { clientSlug: "", category: "ads", platforms: ["instagram"], objectives: ["OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT"] }, level: "campaign", trendMetrics: ["followersGained", "custo"] }),
  },
  {
    id: "builtin-whatsapp-conversations", name: "Conversas no WhatsApp",
    description: "Investimento, alcance, conversas e custo por conversa.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: whatsappPrefs, filters: { clientSlug: "", category: "ads", platforms: [], objectives: ["OUTCOME_ENGAGEMENT"] }, level: "campaign", trendMetrics: ["custo", "mensagens"] }),
  },
];
