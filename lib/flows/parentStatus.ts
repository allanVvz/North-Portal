// O ciclo de vida do card-entrega.
//
// A entrega não é arrastada por ninguém: o status dela é consequência do que
// acontece nas etapas. Duas transições, e só.

import type { TaskRecord, TaskStatus } from "@/lib/validation";

/** Uma Entrega existe antes de o trabalho começar: pai e primeira etapa nascem
 * em Entrada, e a projeção acompanha a etapa somente quando ela é iniciada. */
// A Entrega e sua primeira etapa nascem juntas em Entrada. O pai só acompanha
// Produção quando alguém (ou o cron) realmente inicia a etapa corrente.
export const DELIVERY_INITIAL_STATUS: TaskStatus = "backlog";

/** A entrega só encerra quando todas as etapas do molde existem E terminaram.
 * Uma etapa que ainda não nasceu conta como pendente — é o mesmo motivo pelo
 * qual o progresso divide pelo peso do molde, e não pelo que já foi criado. */
export function deliveryIsFinished(
  steps: readonly Pick<TaskRecord, "completed_at">[],
  totalSteps: number,
): boolean {
  if (totalSteps <= 0) return false;
  if (steps.length < totalSteps) return false;
  return steps.every((step) => Boolean(step.completed_at));
}

/**
 * O status que o card PAI deve MOSTRAR — o da etapa corrente da corrente.
 * "Roteiro em revisão" → pai mostra revisão; "roteiro concluído, captação em
 * Entrada" → pai mostra Entrada.
 *
 * De propósito NÃO é persistida em `tasks.status` — mesmo princípio já
 * documentado para o progresso ("Progresso de pai é sempre rollup dos
 * filhos; nunca persistido", docs/ARQUITETURA-TAREFAS.md): quem for exibir o
 * status de uma entrega (a etapa família no modal, o card de Operação) chama
 * isto sobre a etapa atual em vez de ler `delivery.status` do banco. Isso
 * também é o que deixa a regra "o progresso nunca retrocede" sair de graça:
 * `taskProgress` soma casas de TODAS as etapas materializadas, concluídas
 * inclusive, e nunca lê este valor — o status espelhado pode voltar para
 * Entrada na etapa seguinte sem que uma única casa já conquistada suma.
 *
 * Recebe a etapa JÁ RESOLVIDA por `currentFlowStepOf` (lib/flows/currentStep)
 * — não re-varre a lista. Antes esta função reimplementava a mesma busca
 * (".find(!completed_at) ?? última") só que localmente, e as duas cópias já
 * quase divergiram uma vez; agora há um resolvedor só, chamado uma vez por
 * quem for mostrar o pai, e `mirroredParentStatus`/`mirroredParentDate`/
 * `mirroredParentAssignee` só leem campos do resultado. `null` quando a
 * entrega ainda não tem etapa nenhuma (vazia, esperando
 * `materializeFirstStep`) — não há o que espelhar.
 */
export function mirroredParentStatus<T extends Pick<TaskRecord, "status">>(
  currentStep: T | null,
): TaskStatus | null {
  return currentStep?.status ?? null;
}

/**
 * Regra única para o estado apresentado por qualquer card-pai.
 *
 * Entrega é serial: a primeira etapa ainda aberta é a corrente. Plano é
 * paralelo: uma pendência de maior prioridade operacional domina o conjunto.
 * Rotina recebe a ocorrência aberta mais recente como `members`, então o
 * histórico concluído não contamina o ciclo que está acontecendo agora.
 *
 * O percentual continua em `taskProgress`; estado e percentual não são a
 * mesma régua. Este resolvedor existe para não deixar cada tela voltar a ler o
 * `tasks.status` antigo do pai e divergir do seu próprio conteúdo.
 */
export type ParentStatusTask = Pick<
  TaskRecord,
  "id" | "kind" | "status" | "completed_at" | "workflow_version_id" | "workflow_version" | "recurrence_cadence" | "payload"
>;

const OPEN_STATUS_PRIORITY: readonly TaskStatus[] = [
  "parada",
  "revisao",
  "aprovacao",
  "em_producao",
  "backlog",
];

function isDelivery(task: ParentStatusTask): boolean {
  return Boolean(task.workflow_version_id) && task.payload?.recurrence_group !== true;
}

function isRollup(task: ParentStatusTask): boolean {
  return isDelivery(task) || task.kind === "plano_acao" || Boolean(task.recurrence_cadence);
}

function latestOpenOccurrence<T extends ParentStatusTask>(members: readonly T[]): T | null {
  const open = members.filter((member) => !member.completed_at);
  if (!open.length) return null;
  // `due_date` is intentionally not required here: callers that do not have
  // it still get deterministic order from their already ordered member list.
  return open[open.length - 1] ?? null;
}

function combineOpenStatuses(statuses: readonly TaskStatus[]): TaskStatus {
  for (const candidate of OPEN_STATUS_PRIORITY) {
    if (statuses.includes(candidate)) return candidate;
  }
  return "aprovado";
}

/** Projects a parent state strictly from its descendants. */
export function projectParentStatus<T extends ParentStatusTask>(
  parent: T,
  members: readonly T[] = [],
  membersByParent?: ReadonlyMap<string, readonly T[]>,
  seen = new Set<string>(),
): TaskStatus {
  if (parent.id && seen.has(parent.id)) return "backlog";
  if (parent.id) seen.add(parent.id);

  if (isDelivery(parent)) {
    const current = currentStep(members);
    if (current) return current.status;
    const declared = parent.workflow_version?.workflow_version_steps.length ?? 0;
    return declared > 0 && members.length >= declared && members.every((member) => Boolean(member.completed_at))
      ? "aprovado"
      : "backlog";
  }

  const effectiveMembers = parent.recurrence_cadence && parent.payload?.recurrence_group === true
    ? (() => {
        const current = latestOpenOccurrence(members);
        return current ? [current] : [];
      })()
    : members;

  // An active parent without a current child is waiting for its first item. A
  // terminal routine is the only exception: it is intentionally stopped or
  // ended. Plan/Delivery state is never inherited from an old stored value.
  if (!effectiveMembers.length) {
    const isRecurringTemplate = Boolean(parent.recurrence_cadence) && parent.payload?.recurrence_group === true;
    return isRecurringTemplate && (parent.status === "parada" || parent.status === "aprovado")
      ? parent.status
      : "backlog";
  }

  const statuses = effectiveMembers.map((member) => {
    if (!isRollup(member)) return member.status;
    return projectParentStatus(member, membersByParent?.get(member.id) ?? [], membersByParent, seen);
  });
  return combineOpenStatuses(statuses);
}

function currentStep<T extends ParentStatusTask>(steps: readonly T[]): T | null {
  if (!steps.length) return null;
  return steps.find((step) => !step.completed_at) ?? null;
}

/** Mesma ideia de `mirroredParentStatus`, para as datas — o pai não tem data
 * própria, só mostra a da etapa corrente. */
export function mirroredParentDate<T extends Pick<TaskRecord, "start_date" | "due_date" | "end_date">>(
  currentStep: T | null,
): { start_date: string | null; due_date: string | null; end_date: string | null } | null {
  if (!currentStep) return null;
  return { start_date: currentStep.start_date, due_date: currentStep.due_date, end_date: currentStep.end_date };
}

/** Mesma ideia, para o responsável — o pai não tem responsável próprio, só
 * mostra o da etapa corrente. */
export function mirroredParentAssignee<T extends Pick<TaskRecord, "assignee" | "assignee_profile_ids">>(
  currentStep: T | null,
): { assignee: string | null; assigneeProfileIds: string[] } | null {
  if (!currentStep) return null;
  return { assignee: currentStep.assignee, assigneeProfileIds: currentStep.assignee_profile_ids };
}
