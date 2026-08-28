// Monta a linha da etapa que nasce de uma conclusão. Puro de propósito
// (nenhum IO) — é o que torna as regras de cascata testáveis sem banco.
// Espelho direto de recurringExecutionFields (lib/recurrence.ts), que faz o
// mesmo papel para a recorrência.

import { ACTION_PLAN_PAYLOAD_KEY, FLOW_PREV_TASK_KEY, FLOW_STEP_KEY } from "@/lib/taskRelations";
import { AUTOMATION_ASSIGNEE } from "@/lib/automations/taskAccess";
import type { TaskRecord } from "@/lib/validation";
import type { FlowStepDef } from "./types";
import { flowStepTaskId } from "./ids";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Fields for the step that follows `previous` inside `delivery`.
 *
 * What carries forward is deliberate rather than a blanket copy of the
 * previous card: client, the delivery's own Plano de Ação membership (a step
 * can't hold one of its own — its plan_id is the delivery), and the mold's
 * declared kind/subtype/weight/assignee/visibility. What does NOT carry are
 * the previous step's status, comments, attachments and reviewer decisions:
 * each step is a different job for a different person, and inheriting the
 * roteiro's approval would make the captação look approved before it exists.
 */
export function flowStepFields(
  delivery: TaskRecord,
  step: FlowStepDef,
  previous: TaskRecord | null,
  today = todayIso(),
): Record<string, unknown> {
  const deliveryPlan = delivery.payload?.[ACTION_PLAN_PAYLOAD_KEY];
  const payload: Record<string, unknown> = { [FLOW_STEP_KEY]: step.step_key };
  if (previous) payload[FLOW_PREV_TASK_KEY] = previous.id;
  if (typeof deliveryPlan === "string" && deliveryPlan) payload[ACTION_PLAN_PAYLOAD_KEY] = deliveryPlan;

  return {
    id: flowStepTaskId(delivery.id, step.step_key),
    client_id: delivery.client_id,
    kind: step.kind,
    subtype: step.subtype,
    title: `${delivery.title} — ${step.title}`,
    status: "backlog",
    priority: delivery.priority,
    assignee: step.default_assignee || previous?.assignee || AUTOMATION_ASSIGNEE,
    reviewer_id: delivery.reviewer_id,
    approver_id: delivery.approver_id,
    // The step's structural parent is the delivery. A step never carries
    // flow_template_id — that is what keeps it from starting a flow of its own.
    plan_id: delivery.id,
    flow_template_id: null,
    requires_review: delivery.requires_review,
    requires_approval: delivery.requires_approval,
    // Forward scheduling from the moment the previous step actually finished,
    // not from the delivery's creation: a chain that slipped a week should
    // move its remaining deadlines with it, not report them all as overdue.
    due_date: addDays(today, Math.max(0, step.lead_days)),
    start_date: today,
    end_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    progress_weight: Number(step.progress_weight) || 1,
    description: null,
    client_visible: step.client_visible,
    payload,
    position: step.order_index,
    recurrence_cadence: null,
    recurrence_weekdays: [],
    recurrence_day_of_month: null,
  };
}
