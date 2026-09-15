import { describe, expect, it } from "vitest";
import { periodForCadence, reportPeriodFor } from "./reportData";

describe("reportPeriodFor", () => {
  it("rodando na segunda, cobre segunda a domingo anteriores", () => {
    expect(reportPeriodFor("semanal", "2026-09-21")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("o dia da execução nunca entra no período", () => {
    const p = reportPeriodFor("semanal", "2026-09-14");
    expect(p.to < "2026-09-14").toBe(true);
    expect(p).toEqual(periodForCadence("semanal", "2026-09-13"));
  });
});
