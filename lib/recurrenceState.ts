import type { TaskRecord } from "./validation";
import { EXPLICIT_DATES_KEY } from "./taskDateGrouping";

export const RECURRENCE_CYCLE_KEY = "recurrence_cycle";
export const RECURRENCE_REVISION_KEY = "recurrence_revision";
export const RECURRENCE_GROUP_KEY = "recurrence_group";

export function recurrenceCycleOf(task: Pick<TaskRecord, "payload">): number {
  const value = task.payload?.[RECURRENCE_CYCLE_KEY];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function recurrenceRevisionOf(task: Pick<TaskRecord, "payload">): number {
  const value = task.payload?.[RECURRENCE_REVISION_KEY];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

export function recurrenceParentPayload(payload: Record<string, unknown> | null | undefined, cycle = 0, revision = 1): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(payload ?? {}),
    [RECURRENCE_GROUP_KEY]: true,
    [RECURRENCE_CYCLE_KEY]: cycle,
    [RECURRENCE_REVISION_KEY]: revision,
  };
  delete next[EXPLICIT_DATES_KEY];
  delete next.cycle_completed;
  return next;
}
