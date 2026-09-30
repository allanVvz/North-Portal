// Um revisor humano permanece distinto do responsável, mesmo quando a mesma
// conta ocupa ambos os papéis. A única conclusão automática de uma revisão
// fica reservada ao papel estruturado North AI, avaliado no servidor.

/** Esta combinação de revisor + responsáveis conta como "revisar o próprio
 * trabalho"? */
export function stepSkipsReview(
  _reviewerId: string | null,
  _assigneeProfileIds: readonly string[],
): boolean {
  return false;
}

/** `requires_review` derivado — usado tanto no client (TaskModal, feedback
 * otimista) quanto no server (rotas API, fonte de verdade), sempre a mesma
 * função, para nunca divergir. `reviewerId` já deve chegar aqui como `null`
 * quando o toggle de revisão está desligado (`revisaoOff`) — esta função não
 * conhece esse conceito, só reage ao id que recebeu. */
export function deriveRequiresReview(
  reviewerId: string | null,
  assigneeProfileIds: readonly string[],
  northAiReviewer = false,
): boolean {
  return northAiReviewer || (Boolean(reviewerId) && !stepSkipsReview(reviewerId, assigneeProfileIds));
}
