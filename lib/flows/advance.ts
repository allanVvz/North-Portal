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
//
// N pais: o mesmo roteiro pode servir três peças. Concluí-lo avança as três,
// cada uma no seu slot.

import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { asTaskRecord, errorMessage, getAdminTask, type AdminClient } from "@/lib/automations/taskAccess";
import { notifyFromAutomation } from "@/lib/automations/notify";
import { markTaskParada } from "@/lib/automations/errorHandling";
import { isFlowDelivery } from "@/lib/taskRelations";
import { RECURRENCE_GROUP_KEY } from "@/lib/recurrenceState";
import type { TaskRecord } from "@/lib/validation";
import { flowStepFields, todayIso } from "./stepFields";
import { flowStepTaskId } from "./ids";
import { nextWorkflowStep, workflowByVersionId, type WorkflowStepDef, type WorkflowVersionDef } from "@/lib/workflows";

export type AdvanceOutcome = {
  created: TaskRecord[];
  finished: string[]; // ids das entregas que fecharam com esta conclusão
};

const DUPLICATE_KEY = "23505";

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === DUPLICATE_KEY;
}

/** True quando esta atualização é o momento em que o card ficou pronto.
 * Reconcluir um card que já estava concluído não é um evento — a cascata tem
 * que disparar na transição, nunca a cada salvamento de um card já pronto. */
export function justCompleted(
  before: Pick<TaskRecord, "completed_at">,
  after: Pick<TaskRecord, "completed_at">,
): boolean {
  return !before.completed_at && Boolean(after.completed_at);
}

type WorkflowParent = { delivery: TaskRecord; workflowStepId: string };

async function parentsOf(admin: AdminClient, childId: string): Promise<WorkflowParent[]> {
  const { data, error } = await admin.from("task_links").select("parent_id,workflow_step_id").eq("child_id", childId).eq("relation_kind", "workflow_step");
  if (error) throw error;
  const links = (data ?? []) as { parent_id: string; workflow_step_id: string | null }[];
  const ids = links.map((link) => link.parent_id);
  if (!ids.length) return [];
  const { data: rows, error: rowsError } = await admin.from("tasks").select(TASK_COLUMNS).in("id", ids);
  if (rowsError) throw rowsError;
  const deliveries = new Map((rows ?? []).map((row) => {
    const delivery = asTaskRecord(row);
    return [delivery.id, delivery];
  }));
  return links.flatMap((link) => {
    const delivery = deliveries.get(link.parent_id);
    return delivery && link.workflow_step_id ? [{ delivery, workflowStepId: link.workflow_step_id }] : [];
  });
}

async function stepsOf(admin: AdminClient, parentId: string): Promise<{ id: string; workflowStepId: string }[]> {
  const { data, error } = await admin.from("task_links").select("child_id,workflow_step_id").eq("parent_id", parentId).eq("relation_kind", "workflow_step");
  if (error) throw error;
  return ((data ?? []) as { child_id: string; workflow_step_id: string | null }[])
    .filter((row): row is { child_id: string; workflow_step_id: string } => Boolean(row.workflow_step_id))
    .map((row) => ({ id: row.child_id, workflowStepId: row.workflow_step_id }));
}

async function linkStep(admin: AdminClient, parentId: string, childId: string, step: WorkflowStepDef): Promise<void> {
  const { error } = await admin.from("task_links").insert({
    parent_id: parentId,
    child_id: childId,
    relation_kind: "workflow_step",
    workflow_step_id: step.workflow_step_id,
    slot: step.key,
    position: step.order_index,
  });
  // Já ligado: outro caminho (re-arrasto, reconciliador, requisição
  // concorrente) chegou antes. Isso é sucesso.
  if (error && !isDuplicate(error)) throw error;
}

/** Avança UMA entrega a partir da etapa concluída. Devolve o card criado, ou
 * null quando não havia o que criar (slot já ocupado, ou fim da corrente). */
async function advanceOneDelivery(
  admin: AdminClient,
  delivery: TaskRecord,
  completedStep: TaskRecord,
  workflow: WorkflowVersionDef,
  completedWorkflowStepId: string,
  today: string,
  actorId: string | null = null,
): Promise<TaskRecord | null> {
  const next = nextWorkflowStep(workflow, completedWorkflowStepId);
  if (!next) return null;

  // O slot ocupado é a trava de idempotência que importa aqui: o id
  // determinístico sozinho não bastaria se alguém já tivesse ligado à mão um
  // card existente naquela etapa.
  const existing = await stepsOf(admin, delivery.id);
  if (existing.some((s) => s.workflowStepId === next.workflow_step_id)) return null;

  const fields = flowStepFields(delivery, next, completedStep, today);
  const id = String(fields.id);
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error && !isDuplicate(error)) throw error;

  await linkStep(admin, delivery.id, id, next);
  if (error) {
    // O card já existia (id determinístico); só faltava o elo, que acabou de
    // ser criado. Devolver o card real e não null.
    const recovered = await getAdminTask(admin, id);
    return recovered;
  }
  const created = asTaskRecord(data![0]);
  // A etapa nasce com responsável e revisor herdados da entrega, então o leque
  // já endereça as pessoas certas na primeira linha — é a propriedade "passou a
  // estar envolvido depois" funcionando de graça.
  await notifyFromAutomation(admin, created.id, "task_created", `"${created.title}" foi criado.`, actorId);
  return created;
}

/** Materializa a primeira etapa de uma ocorrência enquanto ela ainda está na
 * mesma transação lógica de criação. A constraint diferida do banco garante
 * que nenhuma Entrega vazia sobreviva ao commit. Idempotente por construção:
 * elo persistido + id determinístico impedem duplicação em corridas. */
export async function materializeFirstStep(admin: AdminClient, delivery: TaskRecord, actorId: string | null = null): Promise<TaskRecord | null> {
  if (!isFlowDelivery(delivery)) return null;
  // O molde recorrente é uma definição, não uma ocorrência. Seus filhos são as
  // ocorrências; cada ocorrência é que recebe as etapas da versão persistida.
  if (delivery.payload?.[RECURRENCE_GROUP_KEY] === true) return null;
  const existing = await stepsOf(admin, delivery.id);
  if (existing.length) return null;

  if (!delivery.workflow_version_id) return null;
  const workflow = await workflowByVersionId(admin, delivery.workflow_version_id);
  if (!workflow?.steps.length) return null;

  const first = workflow.steps[0];
  const fields = flowStepFields(delivery, first, null);
  const id = String(fields.id);
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error && !isDuplicate(error)) throw error;
  await linkStep(admin, delivery.id, id, first);
  if (error) return await getAdminTask(admin, id);

  const created = asTaskRecord(data![0]);
  await notifyFromAutomation(admin, created.id, "task_created", `"${created.title}" foi criado.`, actorId);
  return created;
}

/**
 * Materializa uma etapa específica da versão persistida de um workflow.
 * Idempotente: id determinístico + elo tolerante a `23505`.
 */
export async function ensureWorkflowStep(
  admin: AdminClient,
  parent: TaskRecord,
  stepDefinition: WorkflowStepDef,
  fields: { title?: string; description?: string } = {},
  today = todayIso(),
  actorId: string | null = null,
): Promise<TaskRecord> {
  const id = flowStepTaskId(parent.id, stepDefinition.key);
  const existing = await getAdminTask(admin, id);
  if (existing) {
    // Garante o elo mesmo que o card já tivesse sido criado por outro caminho.
    await linkStep(admin, parent.id, id, stepDefinition);
    return existing;
  }
  const step = flowStepFields(
    parent,
    stepDefinition,
    null,
    today,
  );
  if (fields.title) step.title = fields.title;
  step.kind = "operacional";
  if (fields.description) step.description = fields.description;
  const { data, error } = await admin.from("tasks").insert(step).select(TASK_COLUMNS).limit(1);
  if (error && !isDuplicate(error)) throw error;
  await linkStep(admin, parent.id, id, stepDefinition);
  const created = error ? await getAdminTask(admin, id) : asTaskRecord(data![0]);
  if (!created) throw new Error("Não foi possível materializar a etapa do fluxo.");
  await notifyFromAutomation(admin, created.id, "task_created", `"${created.title}" foi criado.`, actorId);
  return created;
}

/**
 * Fecha uma Entrega somente quando todos os passos declarados na versão estão
 * ligados e concluídos. Passos materializados parcialmente nunca bastam.
 */
export async function settleWorkflowDelivery(admin: AdminClient, parentId: string, actorId: string | null = null): Promise<boolean> {
  const parent = await getAdminTask(admin, parentId);
  if (!parent || !isFlowDelivery(parent)) return false;
  if (!parent.workflow_version_id) return false;
  const workflow = await workflowByVersionId(admin, parent.workflow_version_id);
  if (!workflow?.steps.length) return false;
  const links = await stepsOf(admin, parentId);
  if (links.length !== workflow.steps.length) return false;
  const declared = new Set(workflow.steps.map((step) => step.workflow_step_id));
  if (links.some((link) => !declared.has(link.workflowStepId))) return false;
  const { data, error } = await admin.from("tasks").select("completed_at").in("id", links.map((l) => l.id));
  if (error) throw error;
  const completedSteps = (data ?? []) as { completed_at: string | null }[];
  if (!completedSteps.every((step) => Boolean(step.completed_at))) return false;

  // O banco projeta a conclusão do pai a partir de todas as etapas declaradas.
  // Não escrever `tasks.status` aqui: uma escrita direta concorreria com essa
  // projeção e faria Entregas com revisores ganharem um funil extra depois da
  // última etapa, contrariando a cascata canônica.
  await notifyFromAutomation(admin, parentId, "task_status_changed", `"${parent.title}" foi concluído.`, actorId);
  return true;
}

/**
 * Materializa a próxima etapa em cada entrega de que este card participa.
 *
 * Append-only por construção: só insere. Arrastar uma etapa para fora de
 * Concluído nunca apaga a seguinte — ela pode já carregar comentários, anexos
 * e a decisão de um revisor, e perdê-la por um arrasto errado seria muito pior
 * do que uma corrente momentaneamente fora de ordem.
 */
export async function advanceFlow(admin: AdminClient, completedStep: TaskRecord, actorId: string | null = null): Promise<AdvanceOutcome> {
  const outcome: AdvanceOutcome = { created: [], finished: [] };
  if (!completedStep.completed_at) return outcome;

  const parents = (await parentsOf(admin, completedStep.id)).filter(({ delivery }) => isFlowDelivery(delivery));
  if (!parents.length) return outcome;

  const today = todayIso();

  for (const { delivery, workflowStepId } of parents) {
    if (!delivery.workflow_version_id) continue;
    const workflow = await workflowByVersionId(admin, delivery.workflow_version_id);
    if (!workflow?.steps.length) continue;
    const created = await advanceOneDelivery(admin, delivery, completedStep, workflow, workflowStepId, today, actorId);
    if (created) outcome.created.push(created);
    if (await settleWorkflowDelivery(admin, delivery.id, actorId)) outcome.finished.push(delivery.id);
  }
  return outcome;
}

/**
 * A etapa que vem depois desta em uma entrega, se já existe como card.
 *
 * Serve à interface, não ao motor: quando alguém conclui uma etapa, a próxima
 * já foi criada dentro do mesmo request, e sem devolvê-la a pessoa fica olhando
 * um card concluído sem caminho nenhum para o trabalho seguinte. Com N pais,
 * devolve a primeira encontrada — o card aberto é um só, e o resto da corrente
 * está na caixa de etapas.
 */
export async function nextFlowStepCardOf(admin: AdminClient, step: TaskRecord): Promise<TaskRecord | null> {
  const parents = (await parentsOf(admin, step.id)).filter(({ delivery }) => isFlowDelivery(delivery));
  if (!parents.length) return null;
  for (const { delivery, workflowStepId } of parents) {
    if (!delivery.workflow_version_id) continue;
    const workflow = await workflowByVersionId(admin, delivery.workflow_version_id);
    if (!workflow) continue;
    const next = nextWorkflowStep(workflow, workflowStepId);
    if (!next) continue;
    const { data: links, error } = await admin.from("task_links")
      .select("child_id")
      .eq("parent_id", delivery.id)
      .eq("workflow_step_id", next.workflow_step_id)
      .eq("relation_kind", "workflow_step")
      .limit(1);
    if (error) throw error;
    const childId = (links?.[0] as { child_id?: string } | undefined)?.child_id;
    const card = childId ? await getAdminTask(admin, childId) : null;
    if (card) return card;
  }
  return null;
}

/**
 * A chamada que todo caminho de escrita faz depois de atualizar uma tarefa.
 * Nunca lança: um fluxo que falha em avançar não pode desfazer a mudança de
 * status que a pessoa acabou de fazer, então a falha aparece no próprio card
 * (`parada` + comentário, a mesma convenção das automações) e não como um 500.
 */
export async function advanceFlowAfterUpdate(before: TaskRecord, after: TaskRecord, actorId: string | null = null): Promise<void> {
  if (!justCompleted(before, after)) return;
  const admin = createAdminClient();
  try {
    const finished = new Set<string>();
    let cursor: TaskRecord | null = after;
    for (let guard = 0; cursor && guard < 50; guard += 1) {
      const outcome = await advanceFlow(admin, cursor, actorId);
      outcome.finished.forEach((id) => finished.add(id));

      const next = await nextFlowStepCardOf(admin, cursor);
      if (next?.subtype === "feedback") {
        const { prepareFeedbackCard } = await import("@/lib/automations/conversionFlow");
        for (const { delivery } of await parentsOf(admin, next.id)) {
          await prepareFeedbackCard(admin, delivery);
        }
      }

      if (cursor.subtype === "feedback") {
        const { processConversionFeedback } = await import("@/lib/automations/conversionFlow");
        for (const { delivery } of await parentsOf(admin, cursor.id)) {
          await processConversionFeedback(admin, delivery.id);
        }
      }

      cursor = next?.completed_at ? next : null;
    }

    for (const deliveryId of finished) {
      const delivery = await getAdminTask(admin, deliveryId);
      if (!delivery || delivery.kind !== "automacao") continue;
      const moldId = typeof delivery.payload?.recurrence_parent_id === "string"
        ? delivery.payload.recurrence_parent_id
        : null;
      if (!moldId) continue;
      const mold = await getAdminTask(admin, moldId);
      if (!mold) continue;
      const { ensureFlowOccurrence } = await import("@/lib/automations/execute");
      const next = await ensureFlowOccurrence(admin, mold, mold.due_date ?? todayIso());
      await materializeFirstStep(admin, next, actorId);
    }
  } catch (error) {
    await markTaskParada(admin, after.id, `Não foi possível criar a próxima etapa do fluxo: ${errorMessage(error)}`);
  }
}
