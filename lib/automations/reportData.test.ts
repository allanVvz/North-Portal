import { describe, expect, it } from "vitest";
import { periodForCadence, reportPeriodFor } from "./reportData";
import { runDayForPeriodEnd } from "./run";

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

// Uma revisão é outra versão do MESMO relatório: tem de cobrir a mesma semana.
// Regerar noutro dia deslocava a janela — na CRIS a revisão 1 saiu em 15–21/09
// e a 2 em 17–23/09, contra o relatório de conversão da mesma entrega, que
// seguia em 15–21 (23/09).
describe("runDayForPeriodEnd — regerar não move o período", () => {
  it("reproduz exatamente a janela do relatório revisado", () => {
    const original = reportPeriodFor("semanal", "2026-09-22");
    expect(original).toEqual({ from: "2026-09-15", to: "2026-09-21" });
    expect(reportPeriodFor("semanal", runDayForPeriodEnd(original.to))).toEqual(original);
  });

  it.each(["semanal", "quinzenal", "mensal"] as const)("vale para a cadência %s", (cadence) => {
    const original = reportPeriodFor(cadence, "2026-09-22");
    expect(reportPeriodFor(cadence, runDayForPeriodEnd(original.to))).toEqual(original);
  });
});
