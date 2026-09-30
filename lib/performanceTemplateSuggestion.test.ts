import { describe, expect, it } from "vitest";
import { suggestPerformanceTemplate } from "./performanceTemplateSuggestion";

const post = (objective: string, metrics = {}) => ({ source: "paid" as const, objective, optimizationGoal: "", metrics });
describe("suggestPerformanceTemplate", () => {
  it("usa resultados observados e objetivos", () => {
    expect(suggestPerformanceTemplate([post("OUTCOME_SALES", { compras: 2 })])?.id).toBe("builtin-funil-compras");
    expect(suggestPerformanceTemplate([post("OUTCOME_ENGAGEMENT", { mensagens: 3 })])?.id).toBe("builtin-funil-mensagens");
    expect(suggestPerformanceTemplate([post("OUTCOME_SALES"), post("MESSAGES")])?.id).toBe("builtin-por-resultado");
  });
  it("não sugere sem dados pagos", () => {
    expect(suggestPerformanceTemplate([])).toBeNull();
  });
});
