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
 * O status que o card PAI deve MOSTRAR — o da etapa corrente da corrente:
 * a mais antiga ainda sem `completed_at`, ou a última quando a corrente já
 * terminou (nenhuma etapa em aberto). "Roteiro em revisão" → pai mostra
 * revisão; "roteiro concluído, captação em Entrada" → pai mostra Entrada.
 *
 * De propósito NÃO é persistida em `tasks.status` — mesmo princípio já
 * documentado para o progresso ("Progresso de pai é sempre rollup dos
 * filhos; nunca persistido", docs/ARQUITETURA-TAREFAS.md): quem for exibir o
 * status de uma entrega (a etapa família no modal, o card de Operação) chama
 * isto sobre as etapas atuais em vez de ler `delivery.status` do banco. Isso
 * também é o que deixa a regra "o progresso nunca retrocede" sair de graça:
 * `taskProgress` soma casas de TODAS as etapas materializadas, concluídas
 * inclusive, e nunca lê este valor — o status espelhado pode voltar para
 * Entrada na etapa seguinte sem que uma única casa já conquistada suma.
 *
 * `orderedSteps` precisa vir na ordem da corrente (posição do elo — ver
 * `stepOrderOf`/`flowStepsOf` em lib/taskRelations.ts); esta função não
 * ordena, só percorre. `null` quando a entrega ainda não tem etapa nenhuma
 * (vazia, esperando `materializeFirstStep`) — não há o que espelhar.
 */
export function mirroredParentStatus<T extends Pick<TaskRecord, "status" | "completed_at">>(
  orderedSteps: readonly T[],
): TaskStatus | null {
  if (orderedSteps.length === 0) return null;
  const current = orderedSteps.find((step) => !step.completed_at) ?? orderedSteps[orderedSteps.length - 1];
  return current.status;
}
