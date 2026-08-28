// "Cada card cria o próximo depois da sua conclusão."
//
// O gatilho é `completed_at` passar de null para não-null, e não um status
// específico. O trigger tasks_sync_completed_at (migration
// 20260826090000_task_authorship_and_completion.sql) já carimba essa coluna
// quando o status entra em ('aprovado','concluido') e a limpa quando sai —
// uma definição de "concluído" que independe do caminho de escrita e que
// sobrevive aos toggles por cliente que fazem um card pular direto para
// `aprovado` quando Revisão/Aprovação estão desligadas.
//
// Sempre com o client de serviço: um dos caminhos de conclusão é a aprovação
// feita pelo CLIENTE no portal, e uma conta cliente não tem INSERT em tasks
// (política "tasks admin all"). Mesmo padrão das automações.

import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { asTaskRecord, errorMessage, getAdminTask, type AdminClient } from "@/lib/automations/taskAccess";
import { markTaskParada } from "@/lib/automations/errorHandling";
import { flowParentIdOf, flowStepKeyOf } from "@/lib/taskRelations";
import type { TaskRecord } from "@/lib/validation";
import { flowStepFields, todayIso } from "./stepFields";
import { flowStepTaskId } from "./ids";
import { flowTemplateProblem, getFlowTemplate, nextStepAfter } from "./template";

export type AdvanceOutcome =
  | { status: "not_a_flow_step" }
  | { status: "not_completed" }
  | { status: "flow_finished" }
  | { status: "already_exists"; taskId: string }
  | { status: "created"; task: TaskRecord };

const DUPLICATE_KEY = "23505";

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === DUPLICATE_KEY;
}

/** True when this update is the moment the card became done. Re-completing a
 * card that was already complete is not an event — the cascade must fire on
 * the transition, never on every save of an already-finished card. */
export function justCompleted(
  before: Pick<TaskRecord, "completed_at">,
  after: Pick<TaskRecord, "completed_at">,
): boolean {
  return !before.completed_at && Boolean(after.completed_at);
}

/**
 * Materializes the step that follows `completedStep`, if there is one.
 *
 * Append-only by construction: it only ever inserts. Dragging a step back out
 * of Concluído never deletes the successor — that successor may already carry
 * real work (comments, files, a reviewer's decision), and losing it to a
 * mis-drag would be far worse than a chain that is momentarily out of order.
 */
export async function advanceFlow(admin: AdminClient, completedStep: TaskRecord): Promise<AdvanceOutcome> {
  const stepKey = flowStepKeyOf(completedStep);
  const deliveryId = flowParentIdOf(completedStep);
  if (!stepKey || !deliveryId) return { status: "not_a_flow_step" };
  if (!completedStep.completed_at) return { status: "not_completed" };

  const delivery = await getAdminTask(admin, deliveryId);
  if (!delivery?.flow_template_id) return { status: "not_a_flow_step" };

  const template = await getFlowTemplate(admin, delivery.flow_template_id);
  if (!template) throw new Error("Fluxo não encontrado para esta entrega.");
  const problem = flowTemplateProblem(template);
  if (problem) throw new Error(problem);

  const next = nextStepAfter(template, stepKey);
  if (!next) return { status: "flow_finished" };

  const fields = flowStepFields(delivery, next, completedStep, todayIso());
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error) {
    // The deterministic id already exists: another path (a re-drag, the daily
    // reconciler, a concurrent request) got here first. That is success.
    if (isDuplicate(error)) return { status: "already_exists", taskId: String(fields.id) };
    throw error;
  }
  return { status: "created", task: asTaskRecord(data![0]) };
}

/**
 * A etapa que vem depois desta, se já existe como card.
 *
 * Serve à interface, não ao motor: quando alguém conclui uma etapa, a próxima
 * já foi criada dentro do mesmo request (advanceFlowAfterUpdate roda antes da
 * resposta sair), e sem devolvê-la a pessoa fica olhando um card concluído sem
 * nenhum caminho para o trabalho seguinte — tinha que fechar e reabrir para
 * encontrá-lo. Resolve pelo id determinístico, então é uma leitura direta.
 */
export async function nextFlowStepCardOf(admin: AdminClient, step: TaskRecord): Promise<TaskRecord | null> {
  const stepKey = flowStepKeyOf(step);
  const deliveryId = flowParentIdOf(step);
  if (!stepKey || !deliveryId) return null;
  const delivery = await getAdminTask(admin, deliveryId);
  if (!delivery?.flow_template_id) return null;
  const template = await getFlowTemplate(admin, delivery.flow_template_id);
  if (!template) return null;
  const next = nextStepAfter(template, stepKey);
  if (!next) return null;
  return getAdminTask(admin, flowStepTaskId(delivery.id, next.step_key));
}

/**
 * The call every write path makes after a task update. Never throws: a flow
 * that fails to advance must not roll back the status change the user just
 * made, so the failure is surfaced on the card itself (`parada` + a comment,
 * the same convention automations use) instead of as a 500.
 */
export async function advanceFlowAfterUpdate(before: TaskRecord, after: TaskRecord): Promise<void> {
  if (!justCompleted(before, after)) return;
  if (!flowStepKeyOf(after)) return;
  const admin = createAdminClient();
  try {
    await advanceFlow(admin, after);
  } catch (error) {
    await markTaskParada(admin, after.id, `Não foi possível criar a próxima etapa do fluxo: ${errorMessage(error)}`);
  }
}
