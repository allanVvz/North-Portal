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
  return "concluido";
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
