import type { TaskRecord } from "./validation";

export const DEFERRED_TASK_FLAG = "deferred_until_accessed";
export const ACTION_PLAN_PAYLOAD_KEY = "action_plan_id";

/** Which step of its template a flow card is. Present ONLY on steps — the
 * delivery (parent) is identified by tasks.flow_template_id instead. Keeping
 * the two markers disjoint is what stops a step from starting a flow of its
 * own, the same invariant recurrence has ("a recurring child never inherits
 * the recurrence"). */
export const FLOW_STEP_KEY = "flow_step_key";
/** The step this one was cascaded from, so the editor can jump back to the
 * roteiro instead of hunting for it. */
export const FLOW_PREV_TASK_KEY = "flow_prev_task_id";

const RECURRENCE_RELATION_PAYLOAD_KEYS = [
  "recurrence_parent_id",
  "recurrence_cycle",
  "occurrence_date",
  "explicit_date_group_id",
  DEFERRED_TASK_FLAG,
] as const;

type TaskRelation = Pick<TaskRecord, "plan_id" | "payload">;

export function flowStepKeyOf(task: Pick<TaskRecord, "payload">): string | null {
  const value = task.payload?.[FLOW_STEP_KEY];
  return typeof value === "string" && value ? value : null;
}

/** The delivery a step hangs under. Like a recurring execution, a step keeps
 * its structural parent in plan_id; unlike an ordinary card, that parent is
 * not a Plano de Ação. */
export function flowParentIdOf(task: TaskRelation): string | null {
  return flowStepKeyOf(task) ? task.plan_id : null;
}

export function isFlowDelivery(task: { flow_template_id?: string | null }): boolean {
  return Boolean(task.flow_template_id);
}

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
  // A flow step's plan_id points at its delivery, not at a plan — reading it
  // as plan membership would make the step show up as an activity of a plan
  // that never adopted it, and would let the plan's rollup count it twice.
  if (recurrenceParentIdOf(task) || flowStepKeyOf(task)) return null;
  return task.plan_id;
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

/** Returns the minimal patch that makes `task` independent from `parentId`.
 * Recurrence metadata must be removed together with the FK; leaving it behind
 * would make the task look related even after Postgres sets plan_id to null. */
export function detachedTaskRelationPatch(
  task: TaskRelation,
  parentId: string,
): Record<string, unknown> | null {
  // A step is not a membership you can revoke — it is a stage of a delivery.
  // Cutting the FK would leave a card whose flow_step_key points at a template
  // it no longer belongs to, and would silently drop it out of the delivery's
  // rollup while the denominator still counts it.
  if (flowParentIdOf(task) === parentId) return null;
  if (task.plan_id === parentId) {
    const payload = { ...(task.payload ?? {}) };
    if (recurrenceParentIdOf(task) === parentId) {
      for (const key of RECURRENCE_RELATION_PAYLOAD_KEYS) delete payload[key];
    }
    return { plan_id: null, payload };
  }
  if (task.payload?.[ACTION_PLAN_PAYLOAD_KEY] === parentId) {
    return { payload: withActionPlanId(task.payload, null) };
  }
  return null;
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

/** The Tarefas surface owns only ordinary work cards — never a parent.
 *
 * A flow delivery is excluded for the same reason a Plano de Ação and a
 * recurrence template are: its status is derived from its children, so it has
 * no honest column to sit in. The board shows the work of the moment (the
 * current step); the delivery lives in Operação and in the step's header. */
export function belongsToTaskScreen(
  task: Pick<TaskRecord, "kind" | "recurrence_cadence" | "payload"> & { flow_template_id?: string | null },
): boolean {
  return visibleOnTaskBoard(task) && task.kind !== "plano_acao" && !task.recurrence_cadence && !isFlowDelivery(task);
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

/** The steps of a delivery, in template order when position was seeded from it. */
export function flowStepsOf<T extends TaskRelation>(deliveryId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => flowParentIdOf(task) === deliveryId);
}

export function recurrenceExecutionsOf<T extends Pick<TaskRecord, "payload">>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => recurrenceParentIdOf(task) === parentId);
}

export function recurrenceParentOf<T extends Pick<TaskRecord, "id">>(parentId: string | null, tasks: readonly T[]): T | null {
  if (!parentId) return null;
  return tasks.find((task) => task.id === parentId) ?? null;
}
