// O ciclo de vida do card-entrega.
//
// A entrega não é arrastada por ninguém: o status dela é consequência do que
// acontece nas etapas. Duas transições, e só.

import type { TaskRecord, TaskStatus } from "@/lib/validation";

/** Uma entrega existe porque o trabalho começou — ela nasce direto em produção,
 * em vez de esperar em Entrada por um arrasto que ninguém vai dar (ela nem
 * aparece no quadro). */
export const DELIVERY_INITIAL_STATUS: TaskStatus = "em_producao";

/**
 * Para onde a entrega vai quando a ÚLTIMA etapa é concluída.
 *
 * Entra no funil de conferência se houver quem confira, e encerra se não
 * houver. Revisão antes de Aprovação porque as duas etapas existem e têm donos
 * diferentes — revisor é interno, aprovador é o cliente —, então mandar tudo
 * direto para Aprovação pularia a revisão da North e colocaria na frente do
 * cliente material que ninguém olhou.
 */
export function deliveryStatusOnFinish(delivery: Pick<TaskRecord, "reviewer_id" | "approver_id">): TaskStatus {
  if (delivery.reviewer_id) return "revisao";
  if (delivery.approver_id) return "aprovacao";
  return "aprovado";
}

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
