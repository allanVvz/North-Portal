import type { TaskParentLink, TaskRecord, TaskRelationKind } from "./validation";

export const DEFERRED_TASK_FLAG = "deferred_until_accessed";

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

/** Reads the persisted relation kind. `slot` names only a workflow role. */
export function relationKindOf(link: TaskParentLink): TaskRelationKind {
  return link.relation_kind;
}

function ownershipLink(link: TaskParentLink): boolean {
  const kind = relationKindOf(link);
  return kind === "structural_member" || kind === "workflow_step";
}

// ---- Pertencimento (task_links) ------------------------------------------
//
// `task_links` guarda relações de vários significados. Durante a migração os
// dados antigos ainda podem ter mais de um elo estrutural, mas o contrato de
// destino é um único `structural_member` por card. `workflow_step` pode ser
// N:N de propósito (uma Diária de gravação alimenta várias Entregas); ele é um
// caminho de execução, não um segundo Plano dono. Reuso somente contextual é
// `reference`. A diferença entre Plano e Entrega está no `behavior` do pai;
// a semântica do elo vem de relation_kind.
//
// `plan_id` sobreviveu com um único significado: ocorrência de recorrência,
// que é 1:1 por natureza.

export function parentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter(ownershipLink).map((p) => p.id);
}

export function hasParent(task: TaskRelation, parentId: string): boolean {
  return (task.parents ?? []).some((p) => p.id === parentId && ownershipLink(p));
}

/** Ligações contextuais: aparecem na família como contexto, mas nunca mudam
 * raiz, prazo, responsáveis ou o rollup do card. */
export function referenceParentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter((p) => relationKindOf(p) === "reference").map((p) => p.id);
}

/** Bloqueios explícitos entre cards; também não são parentesco. */
export function dependencyParentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter((p) => relationKindOf(p) === "dependency").map((p) => p.id);
}

/** O slot (etapa) que este card ocupa dentro de um pai específico. O mesmo
 * roteiro pode ocupar o slot "roteiro" em várias entregas. */
export function slotOf(task: TaskRelation, parentId: string): string | null {
  return (task.parents ?? []).find((p) => p.id === parentId && relationKindOf(p) === "workflow_step")?.slot ?? null;
}

/** Identidade persistida de uma etapa dentro de alguma Entrega.
 *
 * O subtipo descreve a Tarefa executável; o papel naquela Entrega vem apenas
 * da FK `workflow_step_id` do elo, pois a mesma Tarefa pode ser reutilizada.
 */
export function flowStepKeyOf(task: Pick<TaskRecord, "parents">): string | null {
  return (task.parents ?? []).find((parent) => relationKindOf(parent) === "workflow_step")?.workflow_step_id ?? null;
}

export function isFlowDelivery(task: {
  workflow_version_id?: TaskRecord["workflow_version_id"];
  payload?: TaskRecord["payload"];
}): boolean {
  return Boolean(task.workflow_version_id);
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

/** Um cliente sai das telas operacionais do dia a dia (quadro Tarefas,
 * Entregas, Rotinas, Plano de Ação, os filtros de cliente delas) por DOIS
 * motivos independentes — `disabled` ("Desabilitado", oculta sem julgar o
 * contrato) e `is_active` ("Inativo", contrato encerrado/pausado). As telas
 * de gestão (`/admin/clientes`, `/admin/documentos`) continuam mostrando
 * todos, para poder reativar — só as telas de trabalho diário filtram por
 * isto. Antes só `disabled` era checado; um cliente marcado só como
 * "Inativo" continuava aparecendo em tudo.
 *
 * `client` ausente (card sem cliente vinculado) sempre passa — a ausência de
 * cliente nunca foi o que este filtro decide. */
export function clientVisibleInOps(client: { disabled?: boolean | null; is_active?: boolean | null } | null | undefined): boolean {
  if (!client) return true;
  return !client.disabled && client.is_active !== false;
}

/** O quadro Tarefas mostra trabalho, nunca um pai.
 *
 * Entrega, Plano de Ação e template de recorrência ficam de fora pela mesma
 * razão: o status deles é derivado dos filhos, então não existe coluna honesta
 * onde encaixá-los. O quadro mostra a etapa de agora; os pais vivem em
 * Operação e no cabeçalho do card filho. */
export function belongsToTaskScreen(
  task: Pick<TaskRecord, "kind" | "recurrence_cadence" | "payload" | "workflow_version_id">,
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

/** A ordem desta etapa DENTRO da corrente deste pai — o `order_index` do
 *  subtipo, gravado no elo pela cascata.
 *
 *  Existe porque a alternativa óbvia (`task.position`) é a posição do card no
 *  QUADRO, que não tem nada a ver com a ordem do fluxo: um card avulso anexado
 *  à mão como etapa chega com a posição que já tinha no Kanban e se enfia na
 *  frente do roteiro. Aconteceu em produção — a etapa de edição do "Evento
 *  Baita 19/09" aparecia como 1/4. */
export function stepOrderOf(task: TaskRelation, parentId: string): number {
  return (task.parents ?? []).find((p) => p.id === parentId)?.position ?? 0;
}

/** Etapas de uma entrega: filhos ligados COM slot, na ordem da corrente.
 *
 * Ordenar aqui dentro (e não em cada chamador) é de propósito: numeração do
 * selo, caixa "Etapas", progresso e a corrente do modal precisam concordar, e
 * três ordenações separadas já divergiram uma vez. Empate cai para a ordem de
 * entrada, que é estável. */
export function flowStepsOf<T extends TaskRelation>(parentId: string, tasks: readonly T[]): T[] {
  return tasks
    .filter((task) => (task.parents ?? []).some((p) => p.id === parentId && relationKindOf(p) === "workflow_step"))
    .sort((a, b) => stepOrderOf(a, parentId) - stepOrderOf(b, parentId));
}

/** Membros de um Plano de Ação: filhos ligados SEM slot. */
export function actionPlanMembersOf<T extends TaskRelation>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => (task.parents ?? []).some((p) => p.id === parentId && relationKindOf(p) === "structural_member"));
}

/** TODOS os Planos de Ação a que este card pertence — um card pode ser
 * membro de mais de um ao mesmo tempo (elo SEM slot, sem limite de
 * cardinalidade no banco nem na aplicação). Use isto para qualquer tela que
 * precise mostrar/considerar a associação real; `planParentIdOf` só existe
 * para os poucos controles que mostram um valor único por desenho (um
 * `<select>`), não porque só possa haver um. */
export function planParentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter((p) => relationKindOf(p) === "structural_member").map((p) => p.id);
}

/** UM Plano de Ação a que este card pertence — o primeiro elo SEM slot
 * encontrado. Existe só para controles de UI que mostram um valor único (um
 * `<select>` de "Plano de Ação"); quando o card pertence a mais de um, qual
 * deles aparece aqui é arbitrário. Para saber TODOS, use `planParentIdsOf`.
 *
 * Ler `parents[0]` no lugar disto é o que fazia uma etapa perder a associação
 * com o plano: a consulta não tem ORDER BY, então "o primeiro pai" podia ser a
 * entrega, e o autosave mandava o id dela como se fosse o plano. */
export function planParentIdOf(task: TaskRelation): string | null {
  return planParentIdsOf(task)[0] ?? null;
}

/** As entregas de que este card é etapa — elos COM slot. */
export function deliveryParentIdsOf(task: TaskRelation): string[] {
  return (task.parents ?? []).filter((p) => relationKindOf(p) === "workflow_step").map((p) => p.id);
}

/** O card-pai "família" deste card, para a visão pai↔filho do modal e para o
 *  thread de comentários compartilhado: a entrega da qual ele é etapa (elo com
 *  slot) tem precedência sobre o plano do qual é atividade (elo sem slot) —
 *  fluxo é a unidade mais estreita. Recorrência fica de fora de propósito: cada
 *  ciclo é uma entrega própria e junta os comentários de meses seria ruído.
 *  `null` quando o card não é filho de nenhum dos dois. */
export function familyRootIdOf(task: TaskRelation): string | null {
  const parents = parentIdsOf(task);
  return parents.length === 1 ? parents[0] : null;
}

export function recurrenceExecutionsOf<T extends Pick<TaskRecord, "payload">>(parentId: string, tasks: readonly T[]): T[] {
  return tasks.filter((task) => recurrenceParentIdOf(task) === parentId);
}

/** The one execution that represents the present tense of a recurring card.
 * Historical completed executions are evidence, never progress for the next
 * cycle. Date is the business ordering; creation is a deterministic tie-break.
 */
export function currentRecurringExecutionOf<T extends Pick<TaskRecord, "payload" | "completed_at" | "due_date" | "created_at">>(
  parentId: string,
  tasks: readonly T[],
): T | null {
  const open = recurrenceExecutionsOf(parentId, tasks).filter((task) => !task.completed_at);
  if (!open.length) return null;
  return [...open].sort((a, b) =>
    (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.created_at.localeCompare(b.created_at),
  ).at(-1) ?? null;
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
