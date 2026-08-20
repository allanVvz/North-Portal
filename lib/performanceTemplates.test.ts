import { describe, expect, it } from "vitest";
import { BUILTIN_PERFORMANCE_TEMPLATES, sanitizePerformanceTemplateConfig } from "./performanceTemplates";

describe("performance templates", () => {
  it("ships the three funnel-stage built-in templates, funil completo first", () => {
    expect(BUILTIN_PERFORMANCE_TEMPLATES.map((template) => template.name)).toEqual([
      "Funil completo",
      "Topo de funil",
      "Fundo de funil",
    ]);
    const bottomFunnel = BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === "builtin-bottom-funnel")!;
    expect(bottomFunnel.config.prefs.customMetrics.find((m) => m.id === "native_cost_per_lead")).toMatchObject({ label: "Custo por lead", format: "money" });
  });

  it("every builtin also carries an Aquisição slice (Parte 5a) so templates drive both screens", () => {
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      expect(template.config.acquisition.kpiSlots.length).toBeGreaterThan(0);
      expect(template.config.acquisition.funnelStages.length).toBeGreaterThanOrEqual(2);
    }
    const topFunnel = BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === "builtin-top-funnel")!;
    expect(topFunnel.config.acquisition.funnelStages).toEqual(["alcance", "impressoes", "cliques"]);
    expect(topFunnel.config.acquisition.showMessageBranch).toBe(false);
  });

  it("sanitizes all shared settings without persisting the client", () => {
    const config = sanitizePerformanceTemplateConfig({
      level: "adset",
      prefs: { trendMetric: "custo" },
      selectedCampaignIds: ["campaign-1", "campaign-1"],
      selectedAdsetIds: ["adset-1"],
      trendMetrics: ["custo", "mensagens", "invalid"],
      filters: { clientSlug: "cliente-a", category: "ads", platforms: ["instagram"], objectives: ["OUTCOME_ENGAGEMENT"] },
      dateRange: { from: "2026-07-01", to: "2026-07-31" },
      cardSources: { trend: "organic", "kpi:custo": "paid", invalid: "other" },
    });
    expect(config.level).toBe("adset");
    expect(config.selectedCampaignIds).toEqual(["campaign-1"]);
    expect(config.selectedAdsetIds).toEqual(["adset-1"]);
    expect(config.trendMetrics).toEqual(["custo", "mensagens"]);
    expect(config.filters.clientSlug).toBe("");
    expect(config.dateRange).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(config.cardSources).toEqual({ trend: "organic", "kpi:custo": "paid" });
  });

  it("falls back safely for unknown values", () => {
    const config = sanitizePerformanceTemplateConfig({ level: "unknown", filters: { category: "broken", platforms: ["tiktok"] } });
    expect(config.level).toBe("campaign");
    expect(config.filters.category).toBe("ads");
    expect(config.filters.platforms).toEqual([]);
    expect(config.dateRange).toBeNull();
    expect(config.cardSources).toEqual({});
  });
});
