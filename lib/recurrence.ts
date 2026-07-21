import { createHash } from "node:crypto";
import type { RecurringCadence, TaskRecord } from "./validation";
import { DEFERRED_TASK_FLAG } from "./taskRelations";

export type RecurrenceRule = {
  cadence: RecurringCadence;
  weekdays: number[];
  dayOfMonth: number | null;
};

/** Calculates the next parent date after one cycle is closed. Date-only and
 * UTC by design: this avoids moving a routine around midnight in BRT. */
export function nextRecurringDueDate(current: string, rule: RecurrenceRule): string {
  const date = new Date(`${current}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Data de recorrência inválida.");

  if (rule.cadence === "quinzenal") date.setUTCDate(date.getUTCDate() + 14);
  else if (rule.cadence === "mensal") {
    const day = rule.dayOfMonth ?? date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else if (rule.weekdays.length) {
    do date.setUTCDate(date.getUTCDate() + 1); while (!rule.weekdays.includes(date.getUTCDay()));
  } else date.setUTCDate(date.getUTCDate() + 7);

  return date.toISOString().slice(0, 10);
}

/** Stable identity makes retries and double clicks converge on one execution. */
export function recurringExecutionId(parentId: string, occurrenceDate: string): string {
  const digest = createHash("sha256").update(`${parentId}:${occurrenceDate}`).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((parseInt(digest[16], 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

export function recurringExecutionFields(parent: TaskRecord, id: string, occurrenceDate: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(parent.payload ?? {}),
    recurrence_parent_id: parent.id,
    occurrence_date: occurrenceDate,
    [DEFERRED_TASK_FLAG]: true,
  };
  delete payload.completed_cycles;
  delete payload.last_completed_at;
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
