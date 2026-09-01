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
import { flowStepKeyOf, isFlowDelivery } from "@/lib/taskRelations";
import { RECURRENCE_GROUP_KEY } from "@/lib/recurrenceState";
import { deliveryIsFinished, deliveryStatusOnFinish } from "./parentStatus";
import {
  deliveryTypeProblem,
  findType,
  listTaskTypes,
  nextSubtypeAfter,
  type TaskTypeDef,
} from "@/lib/taskTypes";
import type { TaskRecord } from "@/lib/validation";
import { flowStepFields, todayIso } from "./stepFields";
import { flowStepTaskId } from "./ids";

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

async function parentsOf(admin: AdminClient, childId: string): Promise<TaskRecord[]> {
  const { data, error } = await admin.from("task_links").select("parent_id").eq("child_id", childId);
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { parent_id: string }).parent_id);
  if (!ids.length) return [];
  const { data: rows, error: rowsError } = await admin.from("tasks").select(TASK_COLUMNS).in("id", ids);
  if (rowsError) throw rowsError;
  return (rows ?? []).map(asTaskRecord);
}

async function stepsOf(admin: AdminClient, parentId: string): Promise<{ id: string; slot: string | null }[]> {
  const { data, error } = await admin.from("task_links").select("child_id,slot").eq("parent_id", parentId);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as { child_id: string; slot: string | null };
    return { id: row.child_id, slot: row.slot };
  });
}

async function linkStep(admin: AdminClient, parentId: string, childId: string, slot: string, position: number): Promise<void> {
  const { error } = await admin.from("task_links").insert({ parent_id: parentId, child_id: childId, slot, position });
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
  type: TaskTypeDef,
  today: string,
): Promise<TaskRecord | null> {
  const next = nextSubtypeAfter(type, flowStepKeyOf(completedStep));
  if (!next) return null;

  // O slot ocupado é a trava de idempotência que importa aqui: o id
  // determinístico sozinho não bastaria se alguém já tivesse ligado à mão um
  // card existente naquela etapa.
  const existing = await stepsOf(admin, delivery.id);
  if (existing.some((s) => s.slot === next.key)) return null;

  const fields = flowStepFields(delivery, next, completedStep, today);
  const id = String(fields.id);
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error && !isDuplicate(error)) throw error;

  await linkStep(admin, delivery.id, id, next.key, next.order_index);
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
  await notifyFromAutomation(admin, created.id, "task_created", `"${created.title}" foi criado.`);
  return created;
}

/** Materializa a PRIMEIRA etapa de uma entrega que ainda não tem nenhuma.
 *
 * Existe por causa da entrega recorrente: cada ocorrência nasce como uma
 * entrega própria — ela herda as marcas de fluxo do template —, mas nasce
 * VAZIA. `advanceFlow` não a resgata, porque aquela varredura é movida por
 * etapa concluída, e uma entrega sem etapa nenhuma nunca conclui nada. Ficaria
 * parada em 0% para sempre.
 *
 * Idempotente por construção: se já existe qualquer elo com slot, não faz
 * nada; e o id da etapa é determinístico, então uma corrida colide na chave
 * primária em vez de duplicar. */
export async function materializeFirstStep(admin: AdminClient, delivery: TaskRecord): Promise<TaskRecord | null> {
  if (!isFlowDelivery(delivery)) return null;
  // Um MOLDE de entrega recorrente carrega `flow_parent` (cada ocorrência herda
  // dele), mas ele não é uma entrega — os filhos dele são as OCORRÊNCIAS, não as
  // etapas. Materializar uma etapa aqui a ligaria direto no molde, sem slot.
  // Ocorrências não herdam `recurrence_group` (recurringExecutionFields o
  // remove), então esta guarda separa molde de ocorrência. Mesmo princípio de
  // flowTotalWeight em lib/taskCatalog.ts.
  if (delivery.payload?.[RECURRENCE_GROUP_KEY] === true) return null;
  const existing = await stepsOf(admin, delivery.id);
  if (existing.some((s) => s.slot !== null)) return null;

  const types = await listTaskTypes(admin);
  const type = findType(types, delivery.kind);
  if (!type || !type.subtypes.length) return null;

  const first = type.subtypes[0];
  const fields = flowStepFields(delivery, first, null);
  const id = String(fields.id);
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error && !isDuplicate(error)) throw error;
  await linkStep(admin, delivery.id, id, first.key, first.order_index);
  if (error) return await getAdminTask(admin, id);

  const created = asTaskRecord(data![0]);
  await notifyFromAutomation(admin, created.id, "task_created", `"${created.title}" foi criado.`);
  return created;
}

/** Fecha a entrega se esta conclusão foi a da última etapa. */
async function settleDelivery(admin: AdminClient, delivery: TaskRecord, type: TaskTypeDef): Promise<boolean> {
  // Uma entrega já encerrada não volta para o funil de conferência. Esta
  // função é chamada toda vez que o reconciliador vê uma etapa concluída —
  // inclusive meses depois, e inclusive para etapas que nasceram já
  // concluídas. Sem esta guarda, qualquer varredura reabre Revisão numa
  // entrega encerrada só porque ela tem revisor.
  if (delivery.completed_at) return false;
  const links = await stepsOf(admin, delivery.id);
  if (links.length === 0) return false;
  const { data, error } = await admin.from("tasks").select("completed_at").in("id", links.map((l) => l.id));
  if (error) throw error;
  const steps = (data ?? []) as { completed_at: string | null }[];
  if (!deliveryIsFinished(steps, type.subtypes.length)) return false;

  const nextStatus = deliveryStatusOnFinish(delivery);
  if (delivery.status === nextStatus) return false;
  const { error: updateError } = await admin.from("tasks").update({ status: nextStatus }).eq("id", delivery.id);
  if (updateError) throw updateError;
  // Só quando o status REALMENTE virou — as guardas acima já garantiram isso.
  // Criar a etapa seguinte e encerrar a entrega são dois fatos distintos, não o
  // mesmo aviso duas vezes.
  await notifyFromAutomation(admin, delivery.id, "task_status_changed", `"${delivery.title}" mudou para ${nextStatus === "aprovado" ? "Concluído" : nextStatus === "revisao" ? "Revisão" : "Aprovação"}.`);
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
export async function advanceFlow(admin: AdminClient, completedStep: TaskRecord): Promise<AdvanceOutcome> {
  const outcome: AdvanceOutcome = { created: [], finished: [] };
  if (!completedStep.completed_at || !flowStepKeyOf(completedStep)) return outcome;

  const parents = (await parentsOf(admin, completedStep.id)).filter(isFlowDelivery);
  if (!parents.length) return outcome;

  const types = await listTaskTypes(admin);
  const today = todayIso();

  for (const delivery of parents) {
    const type = findType(types, delivery.kind);
    if (!type) continue;
    const problem = deliveryTypeProblem(type);
    if (problem) throw new Error(problem);

    const created = await advanceOneDelivery(admin, delivery, completedStep, type, today);
    if (created) outcome.created.push(created);
    if (await settleDelivery(admin, delivery, type)) outcome.finished.push(delivery.id);
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
  const stepKey = flowStepKeyOf(step);
  if (!stepKey) return null;
  const parents = (await parentsOf(admin, step.id)).filter(isFlowDelivery);
  if (!parents.length) return null;
  const types = await listTaskTypes(admin);
  for (const delivery of parents) {
    const type = findType(types, delivery.kind);
    if (!type) continue;
    const next = nextSubtypeAfter(type, stepKey);
    if (!next) continue;
    const card = await getAdminTask(admin, flowStepTaskId(delivery.id, next.key));
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
