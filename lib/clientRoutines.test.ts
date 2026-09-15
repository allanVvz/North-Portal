import { describe, expect, it } from "vitest";
import { CLIENT_STANDARD_ROUTINES, routineScheduleProblem } from "./clientRoutines";

const complete = CLIENT_STANDARD_ROUTINES.map((routine) => ({ key: routine.key, date: "2026-09-21", assigneeId: "p1" }));

describe("routineScheduleProblem", () => {
  it("as cinco rotinas com data e responsável liberam o cadastro", () => {
    expect(routineScheduleProblem(complete)).toBeNull();
  });

  it("sem nenhuma rotina, lista todas", () => {
    expect(routineScheduleProblem(undefined)).toContain("Assinatura de contrato");
  });

  it("rotina sem responsável bloqueia e é nomeada", () => {
    const inputs = complete.map((input) => (input.key === "reuniao_mensal" ? { ...input, assigneeId: "" } : input));
    expect(routineScheduleProblem(inputs)).toBe("Preencha data e responsável das rotinas: Reunião mensal.");
  });

  it("data inválida bloqueia", () => {
    const inputs = complete.map((input) => (input.key === "onboarding" ? { ...input, date: "21/09" } : input));
    expect(routineScheduleProblem(inputs)).toContain("Onboarding");
  });

  it("as periódicas são semanal e mensal", () => {
    const cadences = Object.fromEntries(CLIENT_STANDARD_ROUTINES.map((routine) => [routine.key, routine.cadence]));
    expect(cadences.acompanhamento_semanal).toBe("semanal");
    expect(cadences.reuniao_mensal).toBe("mensal");
    expect(cadences.assinatura_contrato).toBeNull();
  });
});
