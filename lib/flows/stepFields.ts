// Monta a linha da etapa que nasce de uma conclusão. Puro de propósito
// (nenhum IO) — é o que torna as regras de cascata testáveis sem banco.

import { AUTOMATION_ASSIGNEE } from "@/lib/automations/taskAccess";
import { FLOW_PREV_TASK_KEY } from "@/lib/taskRelations";
import type { TaskRecord } from "@/lib/validation";
import type { TaskSubtypeDef } from "@/lib/taskTypes";
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
 * Campos da etapa que segue `previous` dentro de `delivery`.
 *
 * O que passa adiante é declarado, não copiado em bloco: cliente, tipo, e o que
 * o subtipo declara (prazo, peso, responsável padrão, visibilidade). O que NÃO
 * passa é o estado do card anterior — status, descrição, comentários, decisão
 * de revisor: cada etapa é um trabalho diferente, de outra pessoa, e herdar a
 * aprovação do roteiro faria a captação nascer aprovada.
 *
 * O vínculo com a entrega NÃO sai daqui: ele é uma linha em `task_links`,
 * escrita pelo chamador, porque um mesmo card pode pertencer a vários pais.
 */
export function flowStepFields(
  delivery: TaskRecord,
  step: TaskSubtypeDef,
  previous: TaskRecord | null,
  today = todayIso(),
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (previous) payload[FLOW_PREV_TASK_KEY] = previous.id;

  return {
    id: flowStepTaskId(delivery.id, step.key),
    client_id: delivery.client_id,
    // A etapa é do mesmo TIPO da entrega — o que a distingue é o subtipo.
    kind: delivery.kind,
    subtype: step.key,
    title: `${delivery.title} — ${step.label}`,
    status: "backlog",
    priority: delivery.priority,
    assignee: step.default_assignee || previous?.assignee || AUTOMATION_ASSIGNEE,
    reviewer_id: delivery.reviewer_id,
    approver_id: delivery.approver_id,
    // plan_id agora significa exclusivamente "ocorrência de recorrência".
    plan_id: null,
    requires_review: delivery.requires_review,
    requires_approval: delivery.requires_approval,
    // Agenda a partir de hoje, não da criação da entrega: uma corrente que
    // atrasou uma semana move os prazos que faltam junto, em vez de nascer
    // com todos vencidos.
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
