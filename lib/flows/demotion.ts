// "Caminho inverso" do PATCH de tarefas (Entrega → tipo comum) — P0-B item 3.
//
// Uma entrega existente sempre tem ao menos a primeira etapa: createFlowDelivery
// e materializeFirstStep garantem isso na criação (uma entrega sem etapa nem
// aparece — deleteTask desfaz a criação se a primeira etapa falhar). Trocar o
// Tipo dela para um comportamento não-entrega deixaria essa(s) etapa(s) órfãs:
// ligadas por task_links a um pai que parou de significar "corrente de fluxo",
// com `flow_parent` e o peso congelado sobrando no payload. Em vez de tentar
// desmontar a corrente inteira em silêncio (não pedido, e arriscado — a etapa
// pode carregar comentários e a decisão de um revisor), a regra recusa a troca
// com um erro legível. Desvincular as etapas à mão continua possível pela
// caixa de Etapas antes de mudar o Tipo.
import { isFlowDelivery } from "@/lib/taskRelations";
import type { TaskRecord } from "@/lib/validation";

export function flowDemotionProblem(current: Pick<TaskRecord, "payload" | "title">): string | null {
  if (!isFlowDelivery(current)) return null;
  return `"${current.title}" é uma Entrega — trocar o Tipo dela deixaria a corrente de etapas órfã. Desvincule ou apague as etapas antes de mudar o Tipo.`;
}
