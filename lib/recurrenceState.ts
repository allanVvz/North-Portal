import type { TaskRecord, TaskStatus } from "./validation";
import { EXPLICIT_DATES_KEY } from "./taskDateGrouping";

export const RECURRENCE_CYCLE_KEY = "recurrence_cycle";
export const RECURRENCE_REVISION_KEY = "recurrence_revision";
export const RECURRENCE_GROUP_KEY = "recurrence_group";

// Não existe data-limite nem contador de ciclos: uma recorrência avança a cada
// conclusão manual, para sempre, e só PARA quando o card-pai (o molde) é movido
// para uma coluna terminal. `aprovado` = encerrada de propósito; `parada` =
// interrompida — que é também onde uma automação estaciona um card com erro.
// Nos dois casos nenhuma ocorrência nova nasce e a data do molde não avança.
export const RECURRENCE_STOP_STATUSES: readonly TaskStatus[] = ["aprovado", "parada"];

export function recurrenceStopped(status: TaskStatus): boolean {
  return RECURRENCE_STOP_STATUSES.includes(status);
}

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
  // A template can be reconstructed from a former execution. Child-only
  // relation fields must not survive that conversion, otherwise the UI (and
  // future relation queries) can mistake the parent for its own child.
  delete next.recurrence_parent_id;
  delete next.occurrence_date;
  delete next.deferred_until_accessed;
  delete next.explicit_date_group_id;
  return next;
}
