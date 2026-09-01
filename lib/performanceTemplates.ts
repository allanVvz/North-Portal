import {
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

// Bloco de objetivo de uma campanha — dita o grupo de KPIs que ela ganha no
// relatório de anúncios (ver lib/reports/adsReportPdf.tsx). "Site" e "Perfil"
// nem sempre se separam pelo `objective` do Meta, então a classificação é uma
// TAG MANUAL por campanha no template (config.campaignBlocks), com
// suggestCampaignBlock() só como palpite inicial na UI.
export type CampaignBlock = "trafego_site" | "trafego_perfil" | "mensagens" | "engajamento" | "outro";
export const CAMPAIGN_BLOCKS: CampaignBlock[] = ["trafego_site", "trafego_perfil", "mensagens", "engajamento", "outro"];
export const CAMPAIGN_BLOCK_LABEL: Record<CampaignBlock, string> = {
  trafego_site: "Tráfego para o site",
  trafego_perfil: "Tráfego para o perfil",
  mensagens: "Mensagens",
  engajamento: "Engajamento",
  outro: "Outras campanhas",
};

/** Fonte de tráfego de uma conversão — rastreada a partir da primeira mensagem
 *  ("#1", "#2", "#3" por anúncio). Tag manual por anúncio no template. */
export type AdSourceTag = "1" | "2" | "3";
export const AD_SOURCE_TAGS: AdSourceTag[] = ["1", "2", "3"];

/** Palpite do bloco a partir do objetivo/goal do Meta E do nome da campanha
 *  (agências nomeiam "[TRAFEGO] ...", "VENDAS | SITE", "Perfil - seguidores").
 *  Só valor inicial na UI; a tag salva no template é quem manda. */
export function suggestCampaignBlock(objective?: string | null, optimizationGoal?: string | null, name?: string | null): CampaignBlock {
  const hay = `${objective ?? ""} ${optimizationGoal ?? ""} ${name ?? ""}`.toUpperCase();
  if (/MENSAG|MESSAGE|WHATS|CONVERSA|LEAD/.test(hay)) return "mensagens";
  if (/PERFIL|PROFILE|SEGUID|FOLLOW|PAGE_LIKE/.test(hay)) return "trafego_perfil";
  if (/SITE|LINK_CLICK|LANDING|TR[AÁ]FEGO|TRAFFIC/.test(hay)) return "trafego_site";
  if (/ENGAJ|ENGAGEMENT|AWARENESS|ALCANCE|REACH/.test(hay)) return "engajamento";
  return "outro";
}
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
  // Bloco de objetivo por campanha (chave = campaignId, ou campaignName quando
  // não há id — caso Windsor). Additivo: templates antigos sanitizam para `{}`.
  campaignBlocks: Record<string, CampaignBlock>;
  // Fonte #1/#2/#3 por anúncio (chave = adId).
  adSourceTags: Record<string, AdSourceTag>;
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

/** Mapa string→valor-do-enum, mesma forma de sanitizeCardSources. */
function sanitizeTagMap<T extends string>(raw: unknown, allowed: readonly T[]): Record<string, T> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const set = new Set<string>(allowed);
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter(([key, value]) => key.length > 0 && key.length <= 200 && typeof value === "string" && set.has(value))
    .slice(0, 200)) as Record<string, T>;
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
    campaignBlocks: sanitizeTagMap(value.campaignBlocks, CAMPAIGN_BLOCKS),
    adSourceTags: sanitizeTagMap(value.adSourceTags, AD_SOURCE_TAGS),
    level: LEVELS.has(value.level as PerformanceEntityLevel) ? value.level as PerformanceEntityLevel : "campaign",
    selectedCampaignIds: stringList(value.selectedCampaignIds),
    selectedAdsetIds: stringList(value.selectedAdsetIds),
    selectedAdIds: stringList(value.selectedAdIds),
    trendMetrics: trendMetrics.length ? trendMetrics : [prefs.trendMetric],
  };
}

const COST_PER_CONTACT_ID = "native_cost_per_contact";
const COST_PER_PURCHASE_ID = "native_cost_per_purchase";
const COST_PER_RESULT_ID = "native_cost_per_result";
const COST_PER_FOLLOWER_ID = "native_cost_per_follower";
const costPerContact = { id: COST_PER_CONTACT_ID, label: "Custo por conversa", a: "custo" as const, b: "contatos" as const, op: "÷" as const, format: "money" as const };
const costPerPurchase = { id: COST_PER_PURCHASE_ID, label: "Custo por compra", a: "custo" as const, b: "compras" as const, op: "÷" as const, format: "money" as const };
const costPerResult = { id: COST_PER_RESULT_ID, label: "Custo por resultado", a: "custo" as const, b: "resultado" as const, op: "÷" as const, format: "money" as const };
// Seguidores não é preenchido por nenhuma ingestão hoje (ver isNotIntegrated em
// insights.ts). Fica visível por decisão do usuário: é a métrica que ele
// acompanha, e um card rotulado "sem integração" comunica a lacuna melhor do
// que a ausência do card.
const costPerFollower = { id: COST_PER_FOLLOWER_ID, label: "Custo por seguidor", a: "custo" as const, b: "followersGained" as const, op: "÷" as const, format: "money" as const };

// Três builtins, um por tipo de desfecho que a operação persegue. A escolha do
// template é a escolha de "o que conta como resultado nesta conta".
//
// O cache de produção (6 contas, 30 dias) é o que dita esta separação: leads
// aparece em 3 das 6 contas e compras em 2, então um template único com um card
// por desfecho deixava a maior parte da tela vazia. Além disso `leads` e
// `mensagens` medem o MESMO evento — 94 contra 1.311 no mesmo período — e por
// isso viraram a métrica `contatos` (máximo por linha), não dois números.
const messageFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  // 6 KPIs: 4 com dado garantido em todas as contas + os 2 de seguidores, que
  // o usuário quer ver justamente por estarem zerados.
  kpiSlots: ["custo", "alcance", "contatos", `custom:${COST_PER_CONTACT_ID}`, "followersGained", `custom:${COST_PER_FOLLOWER_ID}`].map((metric) => ({ visible: true, metric })),
  trendMetric: "contatos",
  topCampaignsMetric: "contatos",
  visibleColumns: ["alcance", "impressoes", "cliquesLink", "contatos", "custo", "ctr", "cpc", "cpm"],
  customMetrics: [costPerContact, costPerFollower],
});
const purchaseFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["custo", "alcance", "cliquesLink", "compras", `custom:${COST_PER_PURCHASE_ID}`].map((metric) => ({ visible: true, metric })),
  trendMetric: "compras",
  topCampaignsMetric: "compras",
  visibleColumns: ["alcance", "impressoes", "cliquesLink", "compras", "custo", "ctr", "cpc", "cpm"],
  customMetrics: [costPerPurchase],
});
const resultFunnelPrefs = sanitizePerformanceViewPrefs({
  ...PERFORMANCE_VIEW_PREFS_DEFAULT,
  defaultPeriod: 30,
  kpiSlots: ["custo", "alcance", "resultado", `custom:${COST_PER_RESULT_ID}`].map((metric) => ({ visible: true, metric })),
  trendMetric: "resultado",
  topCampaignsMetric: "resultado",
  visibleColumns: ["alcance", "impressoes", "cliquesLink", "resultado", "custo", "ctr", "cpc", "cpm"],
  customMetrics: [costPerResult],
});

// A última etapa de `funnelStages` é o desfecho: é dela que o fecho do funil
// tira o número, o custo e a taxa de conversão (ver ResultPanel).
const messageFunnelAcquisition: AcquisitionViewPrefs = {
  // 6 é o teto do slot. `profileVisits` passou a ser ingerido
  // (instagram_profile_visits, schema v6); `followersGained` segue vazio — a
  // Meta não expõe follows na Marketing API, então a tela rotula "Sem
  // integração" (o relatório de anúncios mostra zerado, de propósito).
  kpiSlots: ["custo", "alcance", "contatos", "profileVisits", `custom:${COST_PER_CONTACT_ID}`, "followersGained"],
  volumeSlots: ["impressoes", "cliques"],
  gaugeSlots: ["cpm", "cpc", "ctr"],
  // Seguidores é etapa do funil (zerada por ora); mensagens é o desfecho.
  funnelStages: ["alcance", "cliquesLink", "followersGained", "contatos"],
  showMessageBranch: false,
  trendMetrics: ["custo", "contatos"],
  // Gauges ("Eficiência de mídia") fora por padrão — o operador liga por
  // template se quiser (o relatório de anúncios respeita).
  hiddenSections: ["gauges"],
};
const purchaseFunnelAcquisition: AcquisitionViewPrefs = {
  kpiSlots: ["custo", "alcance", "compras", `custom:${COST_PER_PURCHASE_ID}`],
  volumeSlots: ["impressoes", "cliques"],
  gaugeSlots: ["cpm", "cpc", "ctr"],
  funnelStages: ["alcance", "cliquesLink", "compras"],
  showMessageBranch: false,
  trendMetrics: ["custo", "compras"],
  hiddenSections: ["gauges"],
};
const resultFunnelAcquisition: AcquisitionViewPrefs = {
  kpiSlots: ["custo", "alcance", "resultado", `custom:${COST_PER_RESULT_ID}`],
  volumeSlots: ["impressoes", "cliques"],
  gaugeSlots: ["cpm", "cpc", "ctr"],
  funnelStages: ["alcance", "cliques", "resultado"],
  showMessageBranch: false,
  trendMetrics: ["custo", "resultado"],
  hiddenSections: ["gauges"],
};

// Nível fica em "campaign" nos três. As linhas de conjunto/criativo só são
// buscadas para campanhas marcadas na tabela (usePerformanceWorkspace), e em
// nível "ad" o currentPaidRows sai dessas mesmas linhas — um template que
// abrisse em "ad" renderizaria KPIs, tendência e ranking vazios até alguém
// selecionar uma campanha.
export const BUILTIN_PERFORMANCE_TEMPLATES: PerformanceTemplate[] = [
  {
    id: "builtin-funil-mensagens", name: "Funil de mensagens",
    description: "Para contas que fecham em conversa. Leads e mensagens contam como o mesmo desfecho.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: messageFunnelPrefs, acquisition: messageFunnelAcquisition, filters: { clientSlug: "", category: "ads", platforms: [], objectives: [] }, level: "campaign", trendMetrics: ["alcance", "contatos"] }),
  },
  {
    id: "builtin-funil-compras", name: "Funil de compras",
    description: "Para contas de e-commerce ou venda direta: o desfecho é a compra.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: purchaseFunnelPrefs, acquisition: purchaseFunnelAcquisition, filters: { clientSlug: "", category: "ads", platforms: [], objectives: [] }, level: "campaign", trendMetrics: ["alcance", "compras"] }),
  },
  {
    id: "builtin-por-resultado", name: "Por resultado",
    description: "Mistura de objetivos: cada campanha conta o desfecho que ela persegue.", scope: "builtin", ownerProfileId: null, updatedAt: null,
    config: sanitizePerformanceTemplateConfig({ version: 1, prefs: resultFunnelPrefs, acquisition: resultFunnelAcquisition, filters: { clientSlug: "", category: "ads", platforms: [], objectives: [] }, level: "campaign", trendMetrics: ["custo", "resultado"] }),
  },
];

export const DEFAULT_BUILTIN_TEMPLATE_ID = "builtin-funil-mensagens";
export const DEFAULT_BUILTIN_TEMPLATE = BUILTIN_PERFORMANCE_TEMPLATES[0];
