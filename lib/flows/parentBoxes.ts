// Quais relações de "Faz parte de" um card pode ter, dado o que ele É.
//
// Existe para que a lista de caixas do modal (TaskModal `parentBoxes`) e o
// placeholder "Carregando card pai…" nunca possam divergir: os dois nascem
// desta mesma função, em vez de cada um repetir a sua própria combinação de
// flags. Foi exatamente essa duplicação que produziu um bug: uma
// entrega-ocorrência de um fluxo recorrente (`createRecurringFlowDelivery`) é
// `isDelivery=true` E filha do molde (`recurrence_parent_id`) ao mesmo tempo.
// A lista de caixas excluía a relação de recorrência para qualquer
// `isDelivery`, mas a condição do placeholder não sabia disso e continuava
// esperando por uma caixa que nunca ia nascer — "Carregando card pai…" para
// sempre nesse card específico.
export type ParentRelationKind = "entrega" | "plano" | "recorrencia";

/**
 * - `entrega` ("Faz parte de: <entrega>"): só para quem NÃO é a própria
 *   entrega — ela não é etapa de si mesma — e nunca para um Plano de Ação
 *   (um Plano não é etapa de ninguém).
 * - `plano` ("Faz parte de: <plano>"): vale para qualquer card que NÃO seja
 *   um Plano — inclusive a entrega, já que quando o fluxo nasce "por dentro"
 *   de um Plano de Ação é a entrega que carrega o `plan_id`, não a etapa
 *   (P1-D3). Um Plano nunca é membro de outro Plano.
 * - `recorrencia` ("Faz parte de: <molde>"): vale para QUALQUER card,
 *   inclusive um Plano de Ação — uma recorrência de Plano
 *   (`createRecurringFlowDelivery`/molde `plano_acao`) gera ocorrências que
 *   também são Planos, e essa ocorrência precisa navegar até o molde como
 *   qualquer outra execução navegaria. "Raiz, nunca filho" vale para
 *   composição (plano/entrega) — não para o eixo do tempo.
 */
export function relevantParentRelationKinds(card: { isDelivery: boolean; isPlan: boolean }): ParentRelationKind[] {
  const kinds: ParentRelationKind[] = [];
  if (!card.isPlan) {
    if (!card.isDelivery) kinds.push("entrega");
    kinds.push("plano");
  }
  kinds.push("recorrencia");
  return kinds;
}
