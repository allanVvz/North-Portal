import { describe, expect, it } from "vitest";
import { buildLayoutPlan } from "./conversionReportPlanning";

describe("planejamento visual da conversao", () => {
  it("usa funil compacto e centralizavel no fallback", () => {
    const plan = buildLayoutPlan({
      period: { from: "2026-09-11", to: "2026-09-17" },
      metrics: { vendas: null, agendamentos: null, receita: null, seguidores: 8000, seguidoresNovos: 47 },
      conversions: [], media: { campaigns: [], ads: [] },
      interpretation: { sourceFingerprint: "abc", comments: [], claims: [], context: [], decision: "", tradeoffs: [] },
      parser: "parser", sourceFingerprint: "abc",
    });
    expect(plan.funnel.width).toBeLessThan(531);
    expect(plan.funnel.lastLevelWidth).toBeLessThan(plan.funnel.width);
    expect(plan.funnel.labelMode).toBe("below");
  });
});
