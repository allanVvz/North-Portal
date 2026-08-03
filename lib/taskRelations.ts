import type { TaskRecord } from "./validation";

export const DEFERRED_TASK_FLAG = "deferred_until_accessed";

export function isDeferredTask(task: Pick<TaskRecord, "payload">): boolean {
  return task.payload?.[DEFERRED_TASK_FLAG] === true;
}

export function visibleOnTaskBoard<T extends Pick<TaskRecord, "payload">>(task: T): boolean {
  return !isDeferredTask(task);
}

/** The Tarefas surface owns only ordinary, non-recurring work cards. */
export function belongsToTaskScreen(task: Pick<TaskRecord, "kind" | "recurrence_cadence" | "payload">): boolean {
  return visibleOnTaskBoard(task) && task.kind !== "plano_acao" && !task.recurrence_cadence;
}

export function activatedTaskPayload(payload: Record<string, unknown> | null | undefined, accessedAt = new Date().toISOString()): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(payload ?? {}), accessed_at: accessedAt };
  delete next[DEFERRED_TASK_FLAG];
  return next;
}

export function childrenOf<T extends Pick<TaskRecord, "plan_id">>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.plan_id === parentId);
}
