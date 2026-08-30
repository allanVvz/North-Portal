import type { TaskParentLink, TaskRecord } from "./validation";

export const DEFERRED_TASK_FLAG = "deferred_until_accessed";

/** Marca de que este card é uma ENTREGA: um pai que agrega etapas em sequência.
 *
 * É uma marca explícita, e não algo inferido do tipo, porque existem cards
 * `criativo` antigos, de antes dos fluxos, que são trabalho comum. Inferir
 * "criativo sem subtipo = entrega" transformaria todos eles em pais de uma
 * hora para outra: sumiriam do quadro (belongsToTaskScreen exclui pais) e
 * passariam a marcar 0% com as etapas todas faltando. Mesmo precedente do
 * `payload.recurrence_group`, que responde a essa mesma pergunta na recorrência. */
export const FLOW_PARENT_KEY = "flow_parent";

/** A etapa anterior da corrente, para o editor conseguir voltar ao roteiro em
 * vez de caçá-lo. */
export const FLOW_PREV_TASK_KEY = "flow_prev_task_id";

const RECURRENCE_RELATION_PAYLOAD_KEYS = [
  "recurrence_parent_id",
  "recurrence_cycle",
  "occurrence_date",
  "explicit_date_group_id",
  DEFERRED_TASK_FLAG,
] as const;

type TaskRelation = Pick<TaskRecord, "parents">;

// ---- Pertencimento (task_links) ------------------------------------------
//
// Um card pode ter VÁRIOS pais: o mesmo roteiro serve três peças, a mesma
// diária de gravação serve vários criativos. Por isso o vínculo saiu de
// `plan_id` (1:1) para a tabela de elos, e é o MESMO mecanismo para Plano de
// Ação e para entrega — a diferença entre os dois está no `behavior` do tipo
// do pai, não na forma como eles seguram os filhos.
//
// `plan_id` sobreviveu com um único significado: ocorrência de recorrência,
// que é 1:1 por natureza.

export function parentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).map((p) => p.id);
}

export function hasParent(task: TaskRelation, parentId: string): boolean {
  return (task.parents ?? []).some((p) => p.id === parentId);
}

/** O slot (etapa) que este card ocupa dentro de um pai específico. O mesmo
 * roteiro pode ocupar o slot "roteiro" em várias entregas. */
export function slotOf(task: TaskRelation, parentId: string): string | null {
  return (task.parents ?? []).find((p) => p.id === parentId)?.slot ?? null;
}

/** A etapa que um card É, dentro de um fluxo: o próprio subtipo dele.
 *
 * Os subtipos de um tipo-entrega SÃO as etapas dele — não existe uma segunda
 * lista para manter em sincronia. O `slot` gravado no elo é a mesma informação
 * denormalizada, para dar para perguntar "este slot já está ocupado neste
 * pai?" sem carregar o card inteiro. */
export function flowStepKeyOf(task: Pick<TaskRecord, "subtype">): string | null {
  return task.subtype || null;
}

export function isFlowDelivery(task: Pick<TaskRecord, "payload">): boolean {
  return task.payload?.[FLOW_PARENT_KEY] === true;
}

export function recurrenceParentIdOf(task: Pick<TaskRecord, "payload">): string | null {
  const value = task.payload?.recurrence_parent_id;
  return typeof value === "string" && value ? value : null;
}

/** Patch que solta a metadata de recorrência quando uma ocorrência é
 * desvinculada do pai. O elo de pertencimento sai por `task_links`, não por
 * aqui — mas deixar a metadata para trás faria o card continuar parecendo
 * relacionado mesmo depois de o Postgres zerar o plan_id. */
export function detachedRecurrencePatch(
  task: Pick<TaskRecord, "plan_id" | "payload">,
  parentId: string,
): Record<string, unknown> | null {
  if (task.plan_id !== parentId) return null;
  const payload = { ...(task.payload ?? {}) };
  if (recurrenceParentIdOf(task) === parentId) {
    for (const key of RECURRENCE_RELATION_PAYLOAD_KEYS) delete payload[key];
  }
  return { plan_id: null, payload };
}

export function isDeferredTask(task: Pick<TaskRecord, "payload">): boolean {
  return task.payload?.[DEFERRED_TASK_FLAG] === true;
}

export function visibleOnTaskBoard<T extends Pick<TaskRecord, "payload">>(task: T): boolean {
  return !isDeferredTask(task) && task.payload?.recurrence_group !== true;
}

/** O quadro Tarefas mostra trabalho, nunca um pai.
 *
 * Entrega, Plano de Ação e template de recorrência ficam de fora pela mesma
 * razão: o status deles é derivado dos filhos, então não existe coluna honesta
 * onde encaixá-los. O quadro mostra a etapa de agora; os pais vivem em
 * Operação e no cabeçalho do card filho. */
export function belongsToTaskScreen(
  task: Pick<TaskRecord, "kind" | "recurrence_cadence" | "payload">,
): boolean {
  return visibleOnTaskBoard(task) && task.kind !== "plano_acao" && !task.recurrence_cadence && !isFlowDelivery(task);
}

export function activatedTaskPayload(payload: Record<string, unknown> | null | undefined, accessedAt = new Date().toISOString()): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(payload ?? {}), accessed_at: accessedAt };
  delete next[DEFERRED_TASK_FLAG];
  return next;
}

/** Filhos de um pai — serve tanto para Plano de Ação quanto para entrega, que
 * agora usam o mesmo mecanismo. */
export function childrenOf<T extends TaskRelation>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => hasParent(task, parentId));
}

// Os dois nomes abaixo ERAM o mesmo `childrenOf`, sem filtro nenhum. Isso só
// era inofensivo enquanto os dois mundos não se encontravam: os filhos de uma
// entrega eram todos etapas, os de um plano eram todos membros. No momento em
// que uma Entrega pode estar dentro de um Plano, e uma etapa também, os nomes
// passariam a mentir — e o `slot` é justamente o discriminador que a tabela de
// elos já carrega para isso.

/** Etapas de uma entrega: filhos ligados COM slot. */
export function flowStepsOf<T extends TaskRelation>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => (task.parents ?? []).some((p) => p.id === parentId && p.slot !== null));
}

/** Membros de um Plano de Ação: filhos ligados SEM slot. */
export function actionPlanMembersOf<T extends TaskRelation>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => (task.parents ?? []).some((p) => p.id === parentId && p.slot === null));
}

/** O Plano de Ação a que este card pertence — o único elo SEM slot.
 *
 * Ler `parents[0]` no lugar disto é o que fazia uma etapa perder a associação
 * com o plano: a consulta não tem ORDER BY, então "o primeiro pai" podia ser a
 * entrega, e o autosave mandava o id dela como se fosse o plano. */
export function planParentIdOf(task: TaskRelation): string | null {
  return (task.parents ?? []).find((p) => p.slot === null)?.id ?? null;
}

/** As entregas de que este card é etapa — elos COM slot. */
export function deliveryParentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter((p) => p.slot !== null).map((p) => p.id);
}

export function recurrenceExecutionsOf<T extends Pick<TaskRecord, "payload">>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => recurrenceParentIdOf(task) === parentId);
}

export function recurrenceParentOf<T extends Pick<TaskRecord, "id">>(parentId: string | null, tasks: readonly T[]): T | null {
  if (!parentId) return null;
  return tasks.find((task) => task.id === parentId) ?? null;
}

/** Agrupa filhos por pai em uma passada — o mapa que o rollup aninhado de
 * taskProgress consome. Com N:N o mesmo card cai em vários baldes, que é
 * exatamente o desejado: ele conta em cada entrega de que participa. */
export function childrenByParent<T extends TaskRelation>(tasks: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const task of tasks) {
    for (const parentId of parentIdsOf(task)) {
      const list = map.get(parentId);
      if (list) list.push(task); else map.set(parentId, [task]);
    }
  }
  return map;
}

export type { TaskParentLink };
