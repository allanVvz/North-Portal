import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/complete", () => ({ aiComplete: vi.fn() }));
import { aiComplete } from "@/lib/ai/complete";
import { northAIContextSchema } from "./aiContracts";
import {
  buildLayoutPlanPrompt,
  buildNarrativePrompt,
  buildVisualRequestPrompt,
  classifyVisualRequest,
  generateLayoutPlan,
  generateNarrative,
} from "./aiPrompts";

const context = northAIContextSchema.parse({
  client: { id: "c", slug: "acme", name: "Acme" },
  period: { from: "2026-09-11", to: "2026-09-17" },
});

describe("prompts estruturados NorthAI", () => {
  it("serializa somente evidencias e instrui resposta JSON", () => {
    const prompt = buildLayoutPlanPrompt(context, "conversion");
    expect(prompt.system).toContain("JSON valido");
    expect(prompt.user).toContain("conversion");
    expect(prompt.user).not.toContain("acme");
    expect(prompt.model).toBe("gpt-4o-mini");
  });

  it("instrui o NorthAI a pedir esclarecimento para pedido visual ambiguo", () => {
    const prompt = buildVisualRequestPrompt(context);
    expect(prompt.system).toContain("needsClarification");
    expect(prompt.system).toContain("nao leia PDF, imagem");
    expect(prompt.model).toBe("gpt-4o-mini");
  });

  it("envia evidencias estruturadas e handoff tipado ao arquiteto", () => {
    const richContext = northAIContextSchema.parse({
      client: { id: "segredo", slug: "cliente-secreto", name: "Cliente Secreto" },
      period: { from: "2026-09-11", to: "2026-09-17" },
      metrics: [{ key: "seguidoresNovos", label: "Seguidores adquiridos", value: 47, previous: 90, difference: -43, percent: -47.78, source: "Feedback" }],
      comments: [{ at: "2026-09-17T10:00:00Z", author: "Revisor Secreto", text: "comentario bruto" }],
    });
    const prompt = buildLayoutPlanPrompt(richContext, "conversion", {
      evidence: {
        history: [{ service: "Consulta", value: 100, source: "1", status: "fechado" }],
        campaigns: [{ id: "cmp", name: "Baita", objective: "LINK_CLICKS", optimizationGoal: "PROFILE_VISIT", metrics: { profileVisits: 12 } }],
      },
      northAIHandoff: [{ kind: "fact", text: "+47 seguidores adquiridos" }],
    });
    const payload = JSON.parse(prompt.user);
    expect(payload.northAIHandoff).toEqual([{ kind: "fact", text: "+47 seguidores adquiridos" }]);
    expect(payload.evidence.campaigns[0]).toMatchObject({ objective: "LINK_CLICKS", optimizationGoal: "PROFILE_VISIT" });
    expect(payload.evidence.metrics[0]).toMatchObject({ previous: 90, difference: -43 });
    expect(prompt.user).not.toContain("Cliente Secreto");
    expect(prompt.user).not.toContain("Revisor Secreto");
    expect(prompt.user).not.toContain("comentario bruto");
    expect(prompt.user).not.toMatch(/thumbnail|permalink|data:application\/pdf|data:image/i);
  });

  it("permite modelo diferente por papel sem alterar o default", () => {
    vi.stubEnv("NORTHAI_MODEL", "north-model");
    vi.stubEnv("DASHBOARD_ARCHITECT_MODEL", "dashboard-model");
    expect(buildNarrativePrompt(context, "conversion").model).toBe("north-model");
    expect(buildLayoutPlanPrompt(context, "conversion").model).toBe("dashboard-model");
  });

  it("classifica um pedido do funil com contrato bounded", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce(JSON.stringify({
      target: "funnel", problem: "too_wide", instruction: "Reduzir e centralizar o ultimo nivel",
      sourceCommentAt: null, needsClarification: false, clarification: null,
    }));
    await expect(classifyVisualRequest(context)).resolves.toMatchObject({ target: "funnel", problem: "too_wide" });
  });

  it("valida resposta JSON cercada por markdown", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("```json\n{\"document\":\"ads\",\"title\":\"Midia\",\"period\":{\"from\":\"2026-09-11\",\"to\":\"2026-09-17\"},\"sections\":[{\"key\":\"kpis\",\"title\":\"KPIs\",\"kind\":\"kpi\",\"order\":0}]}\n```");
    await expect(generateLayoutPlan(context, "ads")).resolves.toMatchObject({ document: "ads", sections: [{ key: "kpis" }] });
  });

  it("rejeita resposta que nao obedece ao contrato", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("{\"document\":\"ads\"}");
    await expect(generateLayoutPlan(context, "ads")).rejects.toThrow();
  });

  it("extrai narrativa tipada", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("{\"narrative\":[{\"kind\":\"fact\",\"text\":\"47 seguidores\"}]}");
    await expect(generateNarrative(context, "conversion")).resolves.toEqual([{ kind: "fact", text: "47 seguidores" }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(aiComplete).mockReset();
  });
});
