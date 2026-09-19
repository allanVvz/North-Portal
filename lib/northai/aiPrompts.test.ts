import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/complete", () => ({ aiComplete: vi.fn() }));
import { aiComplete } from "@/lib/ai/complete";
import { northAIContextSchema } from "./aiContracts";
import { buildLayoutPlanPrompt, generateLayoutPlan, generateNarrative } from "./aiPrompts";

const context = northAIContextSchema.parse({ client: { id: "c", slug: "acme", name: "Acme" }, period: { from: "2026-09-11", to: "2026-09-17" } });

describe("prompts estruturados NorthAI", () => {
  it("serializa contexto no prompt e instrui resposta JSON", () => {
    const prompt = buildLayoutPlanPrompt(context, "conversion");
    expect(prompt.system).toContain("JSON válido");
    expect(prompt.user).toContain("acme");
  });

  it("valida resposta JSON cercada por markdown", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("```json\n{\"document\":\"ads\",\"title\":\"Mídia\",\"period\":{\"from\":\"2026-09-11\",\"to\":\"2026-09-17\"},\"sections\":[{\"key\":\"kpis\",\"title\":\"KPIs\",\"kind\":\"kpi\",\"order\":0}]}\n```");
    await expect(generateLayoutPlan(context, "ads")).resolves.toMatchObject({ document: "ads", sections: [{ key: "kpis" }] });
  });

  it("rejeita resposta que não obedece ao contrato", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("{\"document\":\"ads\"}");
    await expect(generateLayoutPlan(context, "ads")).rejects.toThrow();
  });

  it("extrai narrativa tipada", async () => {
    vi.mocked(aiComplete).mockResolvedValueOnce("{\"narrative\":[{\"kind\":\"fact\",\"text\":\"47 seguidores\"}]}");
    await expect(generateNarrative(context, "conversion")).resolves.toEqual([{ kind: "fact", text: "47 seguidores" }]);
  });
});
