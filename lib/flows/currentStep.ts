// A etapa em que a corrente de uma entrega está agora — usada para decidir
// ONDE grava um comentário feito no card PAI (P1-D do plano de fluxos:
// "se o card estiver em edição, o comentário feito no pai comenta no card de
// edição"). A LEITURA do thread não muda — mergeFamilyComments já junta tudo
// no pai — só o destino da ESCRITA muda. Plano de Ação fica de fora dessa
// regra por decisão do usuário: só entrega/fluxo tem "etapa corrente"; quem
// decide isso é o chamador (app/api/admin/tasks/[id]/comments/route.ts), não
// este módulo.

import type { TaskRecord } from "@/lib/validation";

/**
 * A primeira etapa ainda aberta (sem `completed_at`) é a corrente. Se TODAS já
 * terminaram, a corrente é a ÚLTIMA — a corrente nunca "acaba", e um
 * comentário feito depois do fim da entrega tem que ir para algum lugar; o
 * card mais recente é o destino natural. `null` só quando não há etapa
 * nenhuma ainda (corrente vazia) — aí quem chama decide o fallback
 * (normalmente: comenta na própria entrega, que é o único card que existe).
 *
 * `completed_at` é o mesmo sinal que `deliveryIsFinished` já usa
 * (lib/flows/parentStatus.ts) para "esta etapa terminou" — reaproveitar evita
 * uma segunda definição de "concluído" (ex.: `status === 'aprovado'`)
 * divergindo da primeira. Por isso uma etapa `parada` conta como aberta: ela
 * nunca ganha `completed_at`, então é exatamente onde a corrente travou — e é
 * ali que um comentário feito no pai deve cair.
 *
 * `steps` precisa chegar já na ordem da corrente (a mesma que `flowStepsOf`
 * devolve) — esta função não reordena, para nunca divergir da numeração que a
 * caixa "Etapas" está mostrando na tela.
 */
export function currentFlowStepOf<T extends Pick<TaskRecord, "completed_at">>(
  steps: readonly T[],
): T | null {
  if (steps.length === 0) return null;
  return steps.find((step) => !step.completed_at) ?? steps[steps.length - 1];
}
