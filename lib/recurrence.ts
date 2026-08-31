import type { RecurringCadence, TaskRecord } from "./validation";
import { derivedTaskId } from "./derivedTaskId";
import { DEFERRED_TASK_FLAG } from "./taskRelations";
import { EXPLICIT_DATES_KEY, EXPLICIT_GROUP_KEY } from "./taskDateGrouping";
import { RECURRENCE_CYCLE_KEY, RECURRENCE_GROUP_KEY, RECURRENCE_REVISION_KEY, recurrenceCycleOf } from "./recurrenceState";

export type RecurrenceRule = {
  cadence: RecurringCadence;
  weekdays: number[];
  dayOfMonth: number | null;
  startDate?: string | null;
};

function atNoon(value: string): Date {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Data de recorrência inválida.");
  return date;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  return addDays(date, -date.getUTCDay());
}

function uniqueWeekdays(values: number[]): number[] {
  return [...new Set(values)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
}

/** Os dias-da-semana a persistir numa recorrência. Uma seleção explícita ganha;
 * sem nenhuma, a recorrência dispara no dia-da-semana da própria data de início.
 * A API não exige mais que a pessoa marque um dia — "sem dia" é um atalho válido
 * para "toda semana no mesmo dia em que começa". O motor (nextRecurringDueDate)
 * já fazia esse fallback internamente; aqui ele vira o valor guardado, para que
 * `recurrence_weekdays` nunca fique vazio num card recorrente. */
export function recurrenceWeekdays(weekdays: number[] | null | undefined, startDate: string): number[] {
  const explicit = uniqueWeekdays(weekdays ?? []);
  return explicit.length ? explicit : [atNoon(startDate).getUTCDay()];
}

function nextWeeklyDate(current: Date, weekdays: number[], weekInterval: 1 | 2, anchor: Date): Date {
  for (let offset = 1; offset <= 28; offset += 1) {
    const candidate = addDays(current, offset);
    if (!weekdays.includes(candidate.getUTCDay())) continue;
    const weeksFromAnchor = Math.floor((startOfWeek(candidate).getTime() - startOfWeek(anchor).getTime()) / 604_800_000);
    if (((weeksFromAnchor % weekInterval) + weekInterval) % weekInterval === 0) return candidate;
  }
  throw new Error("Não foi possível calcular a próxima ocorrência.");
}

function monthlyCandidate(anchor: Date, weekdays: number[]): Date {
  let best: Date | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let offset = -7; offset <= 7; offset += 1) {
    const candidate = addDays(anchor, offset);
    if (!weekdays.includes(candidate.getUTCDay())) continue;
    const distance = Math.abs(offset);
    if (distance < bestDistance || (distance === bestDistance && candidate > (best ?? candidate))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!best) throw new Error("Não foi possível calcular a ocorrência mensal.");
  return best;
}

/** Returns the next occurrence after `current`. Weekly and fortnightly rules
 * can emit every selected weekday. Monthly rules keep the start date as their
 * month anchor and choose the selected weekday nearest to it (future wins a
 * tie), within the specified ±7 day window. */
export function nextRecurringDueDate(current: string, rule: RecurrenceRule): string {
  const currentDate = atNoon(current);
  const start = atNoon(rule.startDate ?? current);
  const weekdays = uniqueWeekdays(rule.weekdays.length ? rule.weekdays : [start.getUTCDay()]);

  if (rule.cadence === "semanal") return iso(nextWeeklyDate(currentDate, weekdays, 1, start));
  if (rule.cadence === "quinzenal") return iso(nextWeeklyDate(currentDate, weekdays, 2, start));

  const anchorDay = start.getUTCDate();
  for (let monthOffset = 1; monthOffset <= 240; monthOffset += 1) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthOffset, 1, 12));
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 12)).getUTCDate();
    month.setUTCDate(Math.min(anchorDay, lastDay));
    const candidate = monthlyCandidate(month, weekdays);
    if (candidate > currentDate) return iso(candidate);
  }
  throw new Error("Não foi possível calcular a próxima ocorrência mensal.");
}

/** Stable identity is based on the cycle, not its editable date. The hashing
 * itself now lives in lib/derivedTaskId.ts, shared with flow steps — the digest
 * and therefore every id this has ever produced is unchanged. */
export function recurringExecutionId(parentId: string, cycle: number | string): string {
  return derivedTaskId(parentId, typeof cycle === "number" ? `cycle:${cycle}` : cycle);
}

function occurrenceTimestamp(parent: TaskRecord, occurrenceDate: string): string | null {
  const payloadTime = typeof parent.payload?.hora === "string" ? parent.payload.hora : "";
  const timestampTime = parent.scheduled_start_at?.match(/T(\d{2}:\d{2}(?::\d{2})?)/)?.[1] ?? "";
  const time = payloadTime || timestampTime;
  return time ? `${occurrenceDate}T${time.length === 5 ? `${time}:00` : time}` : null;
}

export function recurringExecutionFields(parent: TaskRecord, id: string, occurrenceDate: string, cycle = recurrenceCycleOf(parent) + 1): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(parent.payload ?? {}),
    recurrence_parent_id: parent.id,
    occurrence_date: occurrenceDate,
    [RECURRENCE_CYCLE_KEY]: cycle,
    [DEFERRED_TASK_FLAG]: true,
  };
  delete payload.completed_cycles;
  delete payload.last_completed_at;
  delete payload[RECURRENCE_GROUP_KEY];
  delete payload[RECURRENCE_REVISION_KEY];
  delete payload.accessed_at;
  return {
    id,
    client_id: parent.client_id,
    kind: parent.kind,
    subtype: parent.subtype,
    title: parent.title,
    status: "backlog",
    priority: parent.priority,
    assignee: parent.assignee,
    reviewer_id: parent.reviewer_id,
    approver_id: parent.approver_id,
    plan_id: parent.id,
    requires_review: parent.requires_review,
    requires_approval: parent.requires_approval,
    due_date: occurrenceDate,
    start_date: occurrenceDate,
    end_date: null,
    scheduled_start_at: occurrenceTimestamp(parent, occurrenceDate),
    scheduled_end_at: null,
    progress_weight: parent.progress_weight,
    description: parent.description,
    client_visible: parent.client_visible,
    payload,
    position: parent.position,
    recurrence_cadence: null,
    recurrence_weekdays: [],
    recurrence_day_of_month: null,
  };
}

/** Compatibility helper for legacy explicit-date groups during migration. */
export function explicitDateExecutionFields(parent: TaskRecord, id: string, occurrenceDate: string, deferred = false): Record<string, unknown> {
  const fields = recurringExecutionFields(parent, id, occurrenceDate);
  const payload: Record<string, unknown> = { ...((fields.payload ?? {}) as Record<string, unknown>), [EXPLICIT_GROUP_KEY]: parent.id };
  if (!deferred) delete payload[DEFERRED_TASK_FLAG];
  delete payload[EXPLICIT_DATES_KEY];
  delete payload.occurrence_date;
  fields.payload = payload;
  return fields;
}

/** The task converted into a routine remains the visible first occurrence. */
export function currentRecurringExecutionFields(parent: TaskRecord, id: string, occurrenceDate: string): Record<string, unknown> {
  const fields = recurringExecutionFields(parent, id, occurrenceDate, 0);
  const payload = { ...((fields.payload ?? {}) as Record<string, unknown>) };
  delete payload[DEFERRED_TASK_FLAG];
  fields.payload = payload;
  return fields;
}
