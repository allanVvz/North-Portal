import { describe, expect, it } from "vitest";
import { layoutPlanSchema, northAIContextSchema } from "./aiContracts";

const context = {
  client: { id: "client-1", slug: "acme", name: "Acme" },
  period: { from: "2026-09-11", to: "2026-09-17" },
};

describe("contratos NorthAI", () => {
  it("aplica defaults e preserva ausência como null", () => {
    const parsed = northAIContextSchema.parse(context);
    expect(parsed.metrics).toEqual([]);
    expect(parsed.media.reach).toBeNull();
    expect(parsed.reports.adsFinal).toBe(false);
  });

  it("rejeita período inválido e valor de métrica não finito", () => {
    expect(() => northAIContextSchema.parse({ ...context, period: { from: "ontem", to: "2026-09-17" } })).toThrow();
    expect(() => northAIContextSchema.parse({ ...context, metrics: [{ key: "x", label: "X", value: Number.NaN, source: "teste" }] })).toThrow();
  });

  it("rejeita seções duplicadas no plano", () => {
    expect(() => layoutPlanSchema.parse({
      document: "conversion", title: "Relatório", period: context.period,
      sections: [
        { key: "resultado", title: "Resultado", kind: "kpi", order: 0 },
        { key: "resultado", title: "Outro", kind: "table", order: 1 },
      ],
    })).toThrow(/Seção duplicada/);
  });

  it("aceita plano declarativo válido", () => {
    const plan = layoutPlanSchema.parse({
      document: "conversion", title: "Relatório de conversão", period: context.period,
      sections: [{ key: "resultado", title: "Resultado principal", kind: "kpi", order: 0 }],
    });
    expect(plan.sections[0].visible).toBe(true);
    expect(plan.narrative).toEqual([]);
  });
});
