import type { TaskRecord } from "./validation";

export const DEFERRED_TASK_FLAG = "deferred_until_accessed";
export const ACTION_PLAN_PAYLOAD_KEY = "action_plan_id";

type TaskRelation = Pick<TaskRecord, "plan_id" | "payload">;

export function recurrenceParentIdOf(task: Pick<TaskRecord, "payload">): string | null {
  const value = task.payload?.recurrence_parent_id;
  return typeof value === "string" && value ? value : null;
}

/** Action-plan membership normally lives in plan_id. Recurring executions
 * reserve that FK for their recurrence parent, so their secondary membership
 * lives in payload.action_plan_id instead. */
export function actionPlanIdOf(task: TaskRelation): string | null {
  const secondary = task.payload?.[ACTION_PLAN_PAYLOAD_KEY];
  if (typeof secondary === "string" && secondary) return secondary;
  return recurrenceParentIdOf(task) ? null : task.plan_id;
}

export function withActionPlanId(
  payload: Record<string, unknown> | null | undefined,
  planId: string | null,
): Record<string, unknown> {
  const next = { ...(payload ?? {}) };
  if (planId) next[ACTION_PLAN_PAYLOAD_KEY] = planId;
  else delete next[ACTION_PLAN_PAYLOAD_KEY];
  return next;
}

/** PATCH callers keep using plan_id as the public plan-link field. On a
 * recurring execution, translate that write to the payload and leave the FK
 * pointing at the recurrence parent. */
export function recurringActionPlanPatch(
  current: TaskRelation,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (!recurrenceParentIdOf(current) || !Object.prototype.hasOwnProperty.call(patch, "plan_id")) return patch;
  const { plan_id, ...rest } = patch;
  const sourcePayload = patch.payload && typeof patch.payload === "object" && !Array.isArray(patch.payload)
    ? patch.payload as Record<string, unknown>
    : current.payload;
  return {
    ...rest,
    payload: withActionPlanId(sourcePayload, typeof plan_id === "string" && plan_id ? plan_id : null),
  };
}

export function isDeferredTask(task: Pick<TaskRecord, "payload">): boolean {
  return task.payload?.[DEFERRED_TASK_FLAG] === true;
}

export function visibleOnTaskBoard<T extends Pick<TaskRecord, "payload">>(task: T): boolean {
  return !isDeferredTask(task) && task.payload?.recurrence_group !== true;
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

export function actionPlanMembersOf<T extends TaskRelation>(planId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => actionPlanIdOf(task) === planId);
}

export function recurrenceExecutionsOf<T extends Pick<TaskRecord, "payload">>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => recurrenceParentIdOf(task) === parentId);
}
