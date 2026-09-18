import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATION_FILTERS, compatibleSubtypes, factualDateOf, factualRoutineEvents, normalizeOperationItems, operationMatchesFilters } from "./operationItems";

const base = {
  client_id: null, kind: "operacional", subtype: null, title: "Card", description: null,
  status: "backlog", priority: "media", assignee: null, assignee_profile_ids: [], reviewer_id: null, approver_id: null,
  plan_id: null, due_date: null, start_date: null, end_date: null, scheduled_start_at: null, scheduled_end_at: null,
  recurrence_cadence: null, recurrence_weekdays: [], recurrence_day_of_month: null, workflow_version_id: null,
  workflow_activated_at: null, task_type_id: null, payload: {}, parents: [], position: 0, completed_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", client_visible: false,
  requires_review: false, requires_approval: false, progress_weight: 1,
} as const;
const task = (id: string, extra: Record<string, unknown> = {}) => ({ ...base, id, ...extra }) as any;
const routine = (id: string, executions: any[] = [], extra: Record<string, unknown> = {}) => ({
  ...task(id, { recurrence_cadence: "semanal", due_date: "2026-09-20", ...extra }), cadence: "semanal", weekdays: [1], day_of_month: null,
  next_due_date: "2026-09-20", time_of_day: null, timezone: "America/Sao_Paulo", active: true, completed_cycles: 0,
  last_completed_at: null, template_payload: {}, source: null, external_id: null, clientName: "Acme", clientSlug: "acme", executions,
}) as any;

describe("operation collection", () => {
  it("keeps templates and ordinary cards but never recurrence executions top-level", () => {
    const execution = task("cycle", { payload: { recurrence_parent_id: "routine" } });
    const items = normalizeOperationItems([task("ordinary"), execution], [routine("routine", [execution])]);
    expect(items.map((item) => item.id)).toEqual(["ordinary", "routine"]);
  });

  it("keeps an ordinary task linked to an action plan", () => {
    const planMember = task("plan-member", { plan_id: "action-plan", payload: {} });
    expect(normalizeOperationItems([planMember], []).map((item) => item.id)).toEqual(["plan-member"]);
  });

  it("intersects Tipo tags and only offers compatible subtypes", () => {
    const automation = routine("auto", [], { kind: "automacao", subtype: "relatorio_trafego" });
    const ordinary = task("ordinary", { kind: "automacao", subtype: "agendamentos" });
    const items = normalizeOperationItems([ordinary], [automation]);
    const filters = [{ attr: "tipo", value: "rotina", label: "Rotina" }, { attr: "tipo", value: "automacao", label: "Automação" }] as const;
    expect(items.filter((item) => operationMatchesFilters(item, filters, "2026-09-18")).map((item) => item.id)).toEqual(["auto"]);
    expect(compatibleSubtypes(items, ["rotina", "automacao"])).toEqual(["relatorio_trafego"]);
  });

  it("default filter hides finished cards and closed routines, keeps everything alive", () => {
    const items = normalizeOperationItems(
      [task("entrada"), task("revisao", { status: "revisao" }), task("parada", { status: "parada" }), task("feito", { status: "aprovado" })],
      [routine("rotina-viva"), routine("rotina-encerrada", [], { status: "aprovado" })],
    );
    expect(items.filter((item) => operationMatchesFilters(item, DEFAULT_OPERATION_FILTERS, "2026-09-18")).map((item) => item.id))
      .toEqual(["entrada", "revisao", "parada", "rotina-viva"]);
  });

  it("ORs Status values but still ANDs them with other attributes", () => {
    const items = normalizeOperationItems([task("a", { status: "backlog", priority: "alta" }), task("b", { status: "revisao", priority: "baixa" }), task("c", { status: "revisao", priority: "alta" })], []);
    const filters = [
      { attr: "status", value: "backlog", label: "Entrada" },
      { attr: "status", value: "revisao", label: "Revisão" },
      { attr: "prioridade", value: "alta", label: "Alta" },
    ] as const;
    expect(items.filter((item) => operationMatchesFilters(item, filters, "2026-09-18")).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("uses only materialized current and completed executions in the calendar", () => {
    const completed = task("done", { completed_at: "2026-09-01T10:00:00Z", due_date: "2026-09-01", payload: { recurrence_parent_id: "routine" } });
    const current = task("now", { due_date: "2026-09-18", scheduled_start_at: "2026-09-18T12:00:00-03:00", payload: { recurrence_parent_id: "routine" } });
    const deferred = task("later", { due_date: "2026-10-01", payload: { recurrence_parent_id: "routine", deferred_until_accessed: true } });
    const events = factualRoutineEvents([routine("routine", [completed, current, deferred])]);
    expect(events.map((event) => [event.execution.id, event.date])).toEqual([["done", "2026-09-01"], ["now", "2026-09-18"]]);
  });

  it("never emits a deferred execution, even when it is completed", () => {
    const deferredDone = task("deferred-done", { completed_at: "2026-09-01T10:00:00Z", due_date: "2026-09-01", payload: { deferred_until_accessed: true } });
    expect(factualRoutineEvents([routine("routine", [deferredDone])])).toEqual([]);
  });

  it("keeps a scheduled timestamp on its agency-calendar day", () => {
    expect(factualDateOf(task("late", { scheduled_start_at: "2026-09-19T23:30:00-03:00", due_date: "2026-09-20" }))).toBe("2026-09-19");
  });

  it("falls back from occurrence date to due date without projecting cadence", () => {
    expect(factualDateOf(task("occurrence", { payload: { occurrence_date: "2026-09-17" }, due_date: "2026-09-20" }))).toBe("2026-09-17");
    expect(factualDateOf(task("due", { due_date: "2026-09-20" }))).toBe("2026-09-20");
  });
});
