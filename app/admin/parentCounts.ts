// Quantas partes um card-pai tem — e a diferença entre um Plano e uma Entrega
// na hora de contar.
//
// Num **Plano de Ação**, tudo que existe já foi montado por alguém: contar as
// atividades responde a pergunta inteira. Numa **Entrega**, parte das etapas
// AINDA NÃO EXISTE como card — cada uma nasce quando a anterior conclui —,
// então contar o que está lá responde errado: uma entrega de quatro etapas com
// só o roteiro pronto pareceria um plano de um item só, completo.
//
// Isso morava dentro de `ParentCardsBoard`, que é a visão Lista. A visão
// Estratégica, que mostra os mesmos cards, não tinha acesso e por isso
// desenhava toda entrega como "plano de N itens" — sem o "3/4" e sem qualquer
// menção às etapas que faltam nascer. Duas telas dizendo coisas diferentes
// sobre o mesmo card.

import { FLOW_STEP_COUNT_KEY } from "@/lib/taskCatalog";
import { FLOW_PARENT_KEY } from "@/lib/taskRelations";

type CountableParent = {
  payload: Record<string, unknown> | null;
  activities: unknown[];
};

/** Quantas etapas o molde previa QUANDO A ENTREGA NASCEU.
 *
 * Vem do instantâneo em `payload`, não de uma consulta ao tipo: o molde pode
 * ter mudado desde então (agora que ele é editável em Configurações › Tipos e
 * fluxos, muda mesmo), e uma entrega em andamento tem que continuar contando
 * pelo que combinou no início — senão ela encolhe ou cresce no meio do
 * caminho. Mesma razão pela qual o progresso usa `flow_total_weight`. */
export function stepTotal(card: CountableParent): number {
  return Number(card.payload?.[FLOW_STEP_COUNT_KEY]) || card.activities.length;
}

/** Etapas que ainda vão nascer. Zero para um plano, sempre. */
export function pendingSteps(card: CountableParent): number {
  if (!isDeliveryCard(card)) return 0;
  return Math.max(0, stepTotal(card) - card.activities.length);
}

/** Entrega (cascateia por etapas) ou Plano (composição manual)?
 *
 * A marca está no payload, não no tipo: existem cards `criativo` legados, de
 * antes dos fluxos, que não são entrega nenhuma. Ver FLOW_PARENT_KEY. */
export function isDeliveryCard(card: CountableParent): boolean {
  return card.payload?.[FLOW_PARENT_KEY] === true;
}

/** O texto que descreve o tamanho do card, na forma certa para o que ele é. */
export function partsLabel(card: CountableParent): string {
  const feitas = card.activities.length;
  if (isDeliveryCard(card)) return `etapa ${feitas}/${stepTotal(card)}`;
  return `${feitas} atividade${feitas === 1 ? "" : "s"}`;
}

/** A frase sobre o que falta nascer, ou null quando não há o que dizer. */
export function pendingLabel(card: CountableParent): string | null {
  const faltam = pendingSteps(card);
  if (!faltam) return null;
  return faltam === 1 ? "Falta 1 etapa" : `Faltam ${faltam} etapas`;
}
