import { describe, expect, it } from "vitest";
import { nextRecurringDueDate, recurrenceOccursOn, recurrenceRuleOf, type RecurrenceRule } from "./recurrence";

// O gate da automação passa a perguntar "hoje casa com a regra?" em vez de ler uma
// coluna mutável. A propriedade que sustenta a troca: o predicado e o agendador
// são a MESMA matemática, então não podem discordar.

const semanal = (weekdays: number[], startDate: string): RecurrenceRule =>
  ({ cadence: "semanal", weekdays, dayOfMonth: null, startDate });

describe("recurrenceOccursOn — semanal", () => {
  it("toda segunda, a partir do início", () => {
    const r = semanal([1], "2026-09-07"); // 07/09 é segunda
    expect(recurrenceOccursOn(r, "2026-09-07")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-14")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-21")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-28")).toBe(true);
    // Terça, quarta… não.
    expect(recurrenceOccursOn(r, "2026-09-22")).toBe(false);
    expect(recurrenceOccursOn(r, "2026-09-20")).toBe(false);
  });

  it("nunca antes da data de início", () => {
    const r = semanal([1], "2026-09-14");
    expect(recurrenceOccursOn(r, "2026-09-07")).toBe(false);
    expect(recurrenceOccursOn(r, "2026-09-14")).toBe(true);
  });

  it("vários dias da semana", () => {
    const r = semanal([1, 4], "2026-09-07"); // segunda e quinta
    expect(recurrenceOccursOn(r, "2026-09-07")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-10")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-11")).toBe(false);
  });

  it("sem dia marcado, usa o dia da semana do início", () => {
    const r = semanal([], "2026-09-16"); // quarta
    expect(recurrenceOccursOn(r, "2026-09-16")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-23")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-21")).toBe(false);
  });
});

describe("recurrenceOccursOn — quinzenal respeita a paridade da semana âncora", () => {
  const r: RecurrenceRule = { cadence: "quinzenal", weekdays: [1], dayOfMonth: null, startDate: "2026-09-07" };
  it("dispara de 14 em 14 dias, não toda segunda", () => {
    expect(recurrenceOccursOn(r, "2026-09-07")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-14")).toBe(false);
    expect(recurrenceOccursOn(r, "2026-09-21")).toBe(true);
    expect(recurrenceOccursOn(r, "2026-09-28")).toBe(false);
  });
});

describe("a propriedade que sustenta a troca", () => {
  it("todo vencimento que o agendador calcula é um dia de ocorrência", () => {
    // Se isto falhar, gate e agendador discordam: a automação calcularia a
    // próxima data e depois se recusaria a rodar nela.
    for (const rule of [
      semanal([1], "2026-09-07"),
      semanal([2, 5], "2026-09-01"),
      { cadence: "quinzenal" as const, weekdays: [3], dayOfMonth: null, startDate: "2026-09-02" },
      { cadence: "mensal" as const, weekdays: [1], dayOfMonth: 15, startDate: "2026-09-15" },
    ]) {
      let day = rule.startDate!;
      for (let i = 0; i < 8; i += 1) {
        day = nextRecurringDueDate(day, rule);
        expect(recurrenceOccursOn(rule, day), `${rule.cadence} ${day}`).toBe(true);
      }
    }
  });
});

describe("recurrenceRuleOf", () => {
  it("card não recorrente não tem regra", () => {
    expect(recurrenceRuleOf({ recurrence_cadence: null, recurrence_weekdays: [], recurrence_day_of_month: null, start_date: null, due_date: null })).toBeNull();
  });

  it("cai no due_date quando não há start_date", () => {
    const rule = recurrenceRuleOf({ recurrence_cadence: "semanal", recurrence_weekdays: [1], recurrence_day_of_month: null, start_date: null, due_date: "2026-09-21" });
    expect(rule).toEqual({ cadence: "semanal", weekdays: [1], dayOfMonth: null, startDate: "2026-09-21" });
  });
});
