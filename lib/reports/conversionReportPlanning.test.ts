import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiModelUnavailableError } from "@/lib/ai/complete";

const promptMocks = vi.hoisted(() => ({
  generateLayoutPlan: vi.fn(),
  generateNarrative: vi.fn(),
}));
vi.mock("@/lib/northai/aiPrompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/northai/aiPrompts")>();
  return { ...actual, ...promptMocks };
});

import { buildLayoutPlan, buildNorthAIContext, planWithNorthAI, type ReportContext } from "./conversionReportPlanning";

const reportContext: ReportContext = {
  period: { from: "2026-09-11", to: "2026-09-17" },
  metrics: { vendas: null, agendamentos: null, receita: null, seguidores: 8000, seguidoresNovos: 47 },
  previousMetrics: { vendas: null, agendamentos: null, receita: null, seguidores: 7953, seguidoresNovos: 90 },
  conversions: [{ servico: "Consulta", valor: 100, fonte: "1", status: "fechado" }],
  media: {
    campaigns: [{
      id: "campaign-row", campaignId: "cmp", campaignName: "Baita", date: "2026-09-12",
      accountId: "a", accountName: "A", platform: "instagram", source: "paid", type: "imagem",
      caption: "Baita", permalink: null, objective: "LINK_CLICKS", optimizationGoal: "PROFILE_VISIT",
      metrics: { alcance: 1000, profileVisits: 120, custo: 60 },
    }],
    ads: [],
  },
  interpretation: { sourceFingerprint: "abc", comments: [], claims: [], context: [], decision: "", tradeoffs: [] },
  parser: "parser",
  sourceFingerprint: "abc",
};

function aiContext() {
  return buildNorthAIContext({
    client: { id: "client", slug: "cliente", name: "Cliente" },
    context: reportContext,
    adsFinal: true,
  });
}

const remoteLayout = {
  document: "conversion" as const,
  title: "Conversao",
  period: reportContext.period,
  sections: [{ key: "result", title: "Resultado", kind: "kpi" as const, order: 0, visible: true, dataKeys: [] }],
  narrative: [], hiddenFields: [],
  creativeCards: { columns: 2 as const, maxLines: 3, minWidth: 200 },
  funnel: { width: 360, maxWidth: 420, nodeWidth: 220, labelMode: "below" as const, lastLevelWidth: 220, gap: 12, maxLabelLines: 2 },
  narrativeLayout: { placement: "first_page" as const, maxParagraphs: 1, maxChars: 500 },
};

describe("planejamento visual da conversao", () => {
  beforeEach(() => {
    vi.stubEnv("NORTHAI_REPORT_PLANNER", "1");
    promptMocks.generateLayoutPlan.mockReset();
    promptMocks.generateNarrative.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("usa funil compacto e centralizavel no fallback", () => {
    const plan = buildLayoutPlan(reportContext);
    expect(plan.funnel.width).toBeLessThan(531);
    expect(plan.funnel.lastLevelWidth).toBeLessThan(plan.funnel.width);
    expect(plan.funnel.labelMode).toBe("below");
  });

  it("calcula comparacao de seguidores sem pedir inferencia ao modelo", () => {
    const metrics = aiContext().metrics;
    expect(metrics.find((metric) => metric.key === "seguidoresNovos")).toMatchObject({ value: 47, previous: 90, difference: -43 });
    expect(metrics.find((metric) => metric.key === "seguidores")).toMatchObject({ value: 8000, previous: 7953, difference: 47 });
  });

  it("executa NorthAI antes e entrega narrativa tipada ao Dashboard Architect", async () => {
    const narrative = [
      { kind: "fact" as const, text: "+47 seguidores adquiridos" },
      { kind: "limitation" as const, text: "Sem atribuicao causal direta a midia." },
    ];
    promptMocks.generateNarrative.mockResolvedValue(narrative);
    promptMocks.generateLayoutPlan.mockResolvedValue(remoteLayout);

    const result = await planWithNorthAI({ context: reportContext, northAIContext: aiContext() });

    expect(result.aiUsed).toBe(true);
    expect(promptMocks.generateNarrative.mock.invocationCallOrder[0]).toBeLessThan(promptMocks.generateLayoutPlan.mock.invocationCallOrder[0]);
    expect(promptMocks.generateLayoutPlan).toHaveBeenCalledWith(expect.anything(), "conversion", expect.objectContaining({
      northAIHandoff: narrative,
      evidence: expect.objectContaining({
        history: [expect.objectContaining({ service: "Consulta", value: 100 })],
        campaigns: [expect.objectContaining({ objective: "LINK_CLICKS", optimizationGoal: "PROFILE_VISIT" })],
      }),
    }));
  });

  it("usa fallback aiUsed=false quando a resposta do arquiteto e invalida", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    promptMocks.generateNarrative.mockResolvedValue([{ kind: "fact", text: "47 seguidores" }]);
    promptMocks.generateLayoutPlan.mockRejectedValue(new Error("NorthAI retornou JSON invalido."));

    const result = await planWithNorthAI({ context: reportContext, northAIContext: aiContext() });

    expect(result.aiUsed).toBe(false);
    expect(result.narrative).toEqual([]);
    expect(result.layout).toEqual(buildLayoutPlan(reportContext));
    expect(result.aiError).toContain("JSON invalido");
  });

  it("usa fallback aiUsed=false quando gpt-4o-mini nao esta disponivel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    promptMocks.generateNarrative.mockRejectedValue(new AiModelUnavailableError("gpt-4o-mini"));

    const result = await planWithNorthAI({ context: reportContext, northAIContext: aiContext() });

    expect(result.aiUsed).toBe(false);
    expect(result.aiError).toContain("gpt-4o-mini");
    expect(promptMocks.generateLayoutPlan).not.toHaveBeenCalled();
  });
});
