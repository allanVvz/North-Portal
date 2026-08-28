import { describe, expect, it } from "vitest";
import { BUILTIN_PERFORMANCE_TEMPLATES, DEFAULT_BUILTIN_TEMPLATE, DEFAULT_BUILTIN_TEMPLATE_ID, sanitizePerformanceTemplateConfig } from "./performanceTemplates";

describe("performance templates", () => {
  it("ships one builtin per tipo de desfecho, funil de mensagens first", () => {
    expect(BUILTIN_PERFORMANCE_TEMPLATES.map((template) => template.name)).toEqual([
      "Funil de mensagens",
      "Funil de compras",
      "Por resultado",
    ]);
    // A tela abre no primeiro do array e a automação usa esta constante como
    // fallback — se deixarem de bater, o padrão da UI e o do PDF divergem.
    expect(DEFAULT_BUILTIN_TEMPLATE_ID).toBe(BUILTIN_PERFORMANCE_TEMPLATES[0].id);
    expect(DEFAULT_BUILTIN_TEMPLATE).toBe(BUILTIN_PERFORMANCE_TEMPLATES[0]);
  });

  it("funil de mensagens funde leads e mensagens e nunca mostra compras", () => {
    const t = BUILTIN_PERFORMANCE_TEMPLATES.find((x) => x.id === "builtin-funil-mensagens")!;
    const kpis = t.config.prefs.kpiSlots.map((slot) => slot.metric);
    // `contatos` = max(mensagens, leads) por linha: os dois medem o mesmo
    // evento, então aparecem como um número só, nunca como dois KPIs.
    expect(kpis).toContain("contatos");
    expect(kpis).not.toContain("mensagens");
    expect(kpis).not.toContain("leads");
    // Compras é desfecho de outra operação — só existe no Funil de compras.
    expect(kpis).not.toContain("compras");
    expect(t.config.prefs.visibleColumns).not.toContain("compras");
    expect(kpis).not.toContain("conversoes");
    // Seguidores fica visível de propósito, mesmo sem ingestão (pedido do
    // usuário: a lacuna é a informação).
    expect(kpis).toContain("followersGained");
    expect(kpis).toContain("custom:native_cost_per_follower");
  });

  it("cada template fecha o funil no seu próprio desfecho", () => {
    const stagesOf = (id: string) =>
      BUILTIN_PERFORMANCE_TEMPLATES.find((x) => x.id === id)!.config.acquisition.funnelStages;
    // ResultPanel lê a ÚLTIMA etapa como desfecho — é ela que vira o número, o
    // custo e a taxa de conversão no fecho do funil.
    expect(stagesOf("builtin-funil-mensagens").at(-1)).toBe("contatos");
    expect(stagesOf("builtin-funil-compras").at(-1)).toBe("compras");
    expect(stagesOf("builtin-por-resultado").at(-1)).toBe("resultado");
  });

  it("nenhum template passa de 6 KPIs no header", () => {
    // O motivo do teto: com um card por desfecho a tela ficava com a maioria
    // das boxes em "—" (leads e compras são zero em 4 das 6 contas de produção).
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      expect(template.config.prefs.kpiSlots.length).toBeLessThanOrEqual(6);
      expect(template.config.acquisition.kpiSlots.length).toBeLessThanOrEqual(6);
    }
  });

  it("todo ref custom: dos builtins existe em prefs.customMetrics", () => {
    // Sem a definição correspondente o sanitizer descarta o slot em silêncio —
    // o KPI simplesmente some do template sem erro nenhum.
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      const ids = new Set(template.config.prefs.customMetrics.map((m) => `custom:${m.id}`));
      const refs = [
        ...template.config.prefs.kpiSlots.map((s) => s.metric),
        ...template.config.acquisition.kpiSlots,
        ...template.config.acquisition.funnelStages,
        ...template.config.acquisition.gaugeSlots,
        ...template.config.acquisition.volumeSlots,
        ...template.config.acquisition.trendMetrics,
        ...template.config.trendMetrics,
        template.config.prefs.topCampaignsMetric,
        template.config.prefs.trendMetric,
      ];
      for (const ref of refs.filter((r) => r.startsWith("custom:"))) {
        expect(ids.has(ref), `${template.id} referencia ${ref} sem defini-lo`).toBe(true);
      }
    }
  });

  it("every builtin also carries an Aquisição slice (Parte 5a) so templates drive both screens", () => {
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      expect(template.config.acquisition.kpiSlots.length).toBeGreaterThan(0);
      expect(template.config.acquisition.funnelStages.length).toBeGreaterThanOrEqual(2);
      // Nível "ad" deixaria KPIs/tendência/ranking vazios até alguém marcar uma
      // campanha — as linhas de criativo só são buscadas para campanhas marcadas.
      expect(template.config.level).toBe("campaign");
    }
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
