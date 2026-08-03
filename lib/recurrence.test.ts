import { describe, expect, it } from "vitest";
import { currentRecurringExecutionFields, explicitDateExecutionFields, nextRecurringDueDate, recurringExecutionFields, recurringExecutionId } from "./recurrence";
import type { TaskRecord } from "./validation";

describe("concluir ciclo recorrente", () => {
  it("avança automaticamente para o próximo dia semanal configurado", () => {
    expect(nextRecurringDueDate("2026-07-20", { cadence: "semanal", weekdays: [1, 4], dayOfMonth: null })).toBe("2026-07-23");
  });

  it("materializa datas explícitas imediatamente sem herdar recorrência", () => {
    const parent = {
      id: "parent", client_id: null, kind: "operacional", subtype: null, title: "Rotina", status: "backlog",
      priority: "media", assignee: null, reviewer_id: null, approver_id: null, plan_id: null,
      requires_review: false, requires_approval: false, due_date: "2026-08-03", start_date: "2026-08-03",
      end_date: null, scheduled_start_at: null, scheduled_end_at: null, progress_weight: 1, description: null,
      client_visible: false, payload: { explicit_occurrence_dates: ["2026-08-03", "2026-08-05"] }, position: 0,
      recurrence_cadence: "semanal", recurrence_weekdays: [1, 3], recurrence_day_of_month: null,
      updated_at: "2026-08-03T00:00:00.000Z",
    } as TaskRecord;
    const child = explicitDateExecutionFields(parent, "child", "2026-08-05");
    expect(child).toMatchObject({ id: "child", plan_id: "parent", due_date: "2026-08-05", recurrence_cadence: null });
    expect(child.payload).toMatchObject({ explicit_date_group_id: "parent" });
    expect(child.payload).not.toHaveProperty("deferred_until_accessed");
    expect(child.payload).not.toHaveProperty("explicit_occurrence_dates");
    const future = explicitDateExecutionFields(parent, "future", "2026-08-05", true);
    expect(future.payload).toMatchObject({ deferred_until_accessed: true, explicit_date_group_id: "parent" });
  });

  it("keeps the converted task as the visible first recurring execution", () => {
    const parent = {
      id: "parent", client_id: null, kind: "operacional", subtype: null, title: "Rotina", status: "backlog",
      priority: "media", assignee: null, reviewer_id: null, approver_id: null, plan_id: null,
      requires_review: false, requires_approval: false, due_date: "2026-08-03", start_date: "2026-08-03",
      end_date: null, scheduled_start_at: null, scheduled_end_at: null, progress_weight: 1, description: null,
      client_visible: false, payload: {}, position: 0, recurrence_cadence: "semanal",
      recurrence_weekdays: [1], recurrence_day_of_month: null,
      updated_at: "2026-08-03T00:00:00.000Z",
    } as TaskRecord;
    const child = currentRecurringExecutionFields(parent, "original", "2026-08-03");
    expect(child).toMatchObject({ id: "original", plan_id: "parent", recurrence_cadence: null });
    expect(child.payload).not.toHaveProperty("deferred_until_accessed");
  });

  it("efetiva três ciclos semanais na ordem configurada e vira a semana sem pular execução", () => {
    const rule = { cadence: "semanal" as const, weekdays: [1, 3, 5], dayOfMonth: null };
    const dates = ["2026-07-20"];
    for (let cycle = 0; cycle < 4; cycle += 1) dates.push(nextRecurringDueDate(dates.at(-1)!, rule));
    expect(dates).toEqual(["2026-07-20", "2026-07-22", "2026-07-24", "2026-07-27", "2026-07-29"]);
  });

  it("gera um id por ocorrência e repete o mesmo id em tentativas idempotentes", () => {
    const monday = recurringExecutionId("parent", "2026-07-20");
    expect(recurringExecutionId("parent", "2026-07-20")).toBe(monday);
    expect(recurringExecutionId("parent", "2026-07-22")).not.toBe(monday);
    expect(monday).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("avança quatorze dias na recorrência quinzenal", () => {
    expect(nextRecurringDueDate("2026-07-20", { cadence: "quinzenal", weekdays: [], dayOfMonth: null })).toBe("2026-08-03");
  });

  it("mantém o dia mensal e limita ao último dia de meses curtos", () => {
    expect(nextRecurringDueDate("2026-01-31", { cadence: "mensal", weekdays: [], dayOfMonth: 31 })).toBe("2026-02-28");
  });

  it("cria uma execução independente e relacionada diretamente ao pai", () => {
    const parent = {
      id: "parent", client_id: "client", kind: "operacional", subtype: null, title: "Rotina", status: "backlog",
      priority: "media", assignee: null, reviewer_id: null, approver_id: null, plan_id: null,
      requires_review: false, requires_approval: false, due_date: "2026-07-20", start_date: "2026-07-20",
      end_date: null, scheduled_start_at: null, scheduled_end_at: null, progress_weight: 1, description: null,
      client_visible: false, payload: { completed_cycles: 2 }, position: 3, recurrence_cadence: "semanal",
      recurrence_weekdays: [1], recurrence_day_of_month: null,
      updated_at: "2026-07-20T00:00:00.000Z",
    } satisfies TaskRecord;
    const child = recurringExecutionFields(parent, "child", "2026-07-27");
    expect(child.plan_id).toBe(parent.id);
    expect(child.due_date).toBe("2026-07-27");
    expect(child.recurrence_cadence).toBeNull();
    expect(child.payload).toMatchObject({
      recurrence_parent_id: parent.id,
      occurrence_date: "2026-07-27",
      deferred_until_accessed: true,
    });
  });
});
