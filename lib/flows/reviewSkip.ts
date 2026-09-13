// Auto-revisão: quando o revisor de um card é a MESMA pessoa que o único
// responsável vinculado, revisar seria revisar o próprio trabalho — o card
// pula a etapa de revisão (P-papéis: decisão do usuário, 2026-09-12).
//
// "Único" é literal: com dois ou mais responsáveis vinculados, mesmo que o
// revisor seja um deles, a revisão continua valendo — outra pessoa também fez
// parte do trabalho. Por decisão do usuário, sem backfill: isto só se aplica
// a partir da próxima vez que alguém editar responsável/revisor de cada card;
// dados históricos com essa combinação não são corrigidos retroativamente.
//
// `assigneeProfileIds` é sempre o vínculo ESTRUTURADO (`task_assignees`,
// resolvido por profile_id) — nunca o texto livre do campo `assignee`. Um
// nome digitado à mão, sem conta, não tem id pra comparar com `reviewerId` e
// portanto nunca aciona esta regra.

/** Esta combinação de revisor + responsáveis conta como "revisar o próprio
 * trabalho"? */
export function stepSkipsReview(
  reviewerId: string | null,
  assigneeProfileIds: readonly string[],
): boolean {
  return (
    reviewerId !== null &&
    assigneeProfileIds.length === 1 &&
    assigneeProfileIds[0] === reviewerId
  );
}

/** `requires_review` derivado — usado tanto no client (TaskModal, feedback
 * otimista) quanto no server (rotas API, fonte de verdade), sempre a mesma
 * função, para nunca divergir. `reviewerId` já deve chegar aqui como `null`
 * quando o toggle de revisão está desligado (`revisaoOff`) — esta função não
 * conhece esse conceito, só reage ao id que recebeu. */
export function deriveRequiresReview(
  reviewerId: string | null,
  assigneeProfileIds: readonly string[],
): boolean {
  return Boolean(reviewerId) && !stepSkipsReview(reviewerId, assigneeProfileIds);
}
