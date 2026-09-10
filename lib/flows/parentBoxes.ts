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
 *   entrega — ela não é etapa de si mesma.
 * - `plano` ("Faz parte de: <plano>"): vale para qualquer card, INCLUSIVE a
 *   entrega — quando o fluxo nasce "por dentro" de um Plano de Ação, é a
 *   entrega que carrega o `plan_id`, não a etapa (P1-D3).
 * - `recorrencia` ("Faz parte de: <molde>"): vale para qualquer card,
 *   INCLUSIVE a entrega — a entrega-ocorrência de um fluxo recorrente precisa
 *   navegar até o molde como qualquer outra ocorrência navegaria.
 *
 * Um Plano de Ação nunca tem nenhuma das três: ele é raiz por este mecanismo,
 * nunca filho. `isPlan` está aqui, explícito, para essa regra não depender de
 * quem chama lembrar de checá-la por fora — foi assim que a exclusão de
 * `isDelivery` acabou indo parar em dois lugares diferentes da tela.
 */
export function relevantParentRelationKinds(card: { isDelivery: boolean; isPlan: boolean }): ParentRelationKind[] {
  if (card.isPlan) return [];
  const kinds: ParentRelationKind[] = [];
  if (!card.isDelivery) kinds.push("entrega");
  kinds.push("plano");
  kinds.push("recorrencia");
  return kinds;
}
