import { describe, expect, it } from "vitest";
import { inferDateGroupRule, nextExplicitOccurrenceDate, normalizeOccurrenceDates, parentTemplatePatch, replicaPatch, replicatedExecutionPayload } from "./taskDateGrouping";

describe("agrupamento de tarefas por datas explícitas", () => {
  it("normaliza, ordena, remove repetidas e ignora datas impossíveis", () => {
    expect(normalizeOccurrenceDates(["2026-08-08", "2026-08-01", "2026-08-08", "2026-02-31"])).toEqual(["2026-08-01", "2026-08-08"]);
  });

  it("infere semanal, quinzenal e mensal sem pedir dia do mês", () => {
    expect(inferDateGroupRule(["2026-08-03", "2026-08-05"])).toEqual({ cadence: "semanal", weekdays: [1, 3], dayOfMonth: null });
    expect(inferDateGroupRule(["2026-08-03", "2026-08-17"])).toEqual({ cadence: "quinzenal", weekdays: [], dayOfMonth: null });
    expect(inferDateGroupRule(["2026-08-10", "2026-09-10"])).toEqual({ cadence: "mensal", weekdays: [], dayOfMonth: 10 });
  });

  it("replica conteúdo e estado, mas nunca identidade nem datas", () => {
    const patch = { title: "Novo", status: "em_producao", payload: { comments: [] }, due_date: "2026-09-01", plan_id: "x", recurrence_cadence: "semanal" };
    expect(replicaPatch(patch)).toEqual({ title: "Novo", status: "em_producao", payload: { comments: [] } });
    expect(parentTemplatePatch(patch)).toEqual({ title: "Novo" });
  });

  it("preserva o estado local da execução futura ao replicar o payload", () => {
    expect(replicatedExecutionPayload(
      { comments: [{ text: "Novo" }], explicit_date_group_id: "origem", accessed_at: "agora" },
      { explicit_date_group_id: "grupo", deferred_until_accessed: true },
    )).toEqual({
      comments: [{ text: "Novo" }],
      explicit_date_group_id: "grupo",
      deferred_until_accessed: true,
    });
  });

  it("encerra uma agenda explícita sem inventar uma terceira data", () => {
    const dates = ["2026-08-03", "2026-08-05"];
    expect(nextExplicitOccurrenceDate(dates, dates[0])).toBe(dates[1]);
    expect(nextExplicitOccurrenceDate(dates, dates[1])).toBeNull();
  });

  // Pertencimento a um plano saiu do payload e virou elo em task_links, então
  // não há mais o que impedir de replicar aqui — o que continua local à
  // ocorrência é o estado dela (deferred/accessed/data).
  it("não replica o estado local de uma ocorrência para a seguinte", () => {
    expect(replicatedExecutionPayload(
      { comments: [], accessed_at: "ontem" },
      { deferred_until_accessed: true },
    )).toEqual({ comments: [], deferred_until_accessed: true });
  });
});
