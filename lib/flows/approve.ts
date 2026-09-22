// A ÚNICA porta pela qual uma automação aprova uma etapa.
//
// Aprovar é duas coisas que têm de andar juntas: o compare-and-set para
// `aprovado` e a cascata que nasce dela (`advanceFlowAfterUpdate` materializa a
// etapa seguinte, ou fecha a Entrega e pré-cria a ocorrência da semana). Escritas
// por humano já compartilham esse ponto em `updateTaskGroup` — o comentário lá
// diz que fica no caso de uso, e não nas rotas, justamente para a aprovação do
// cliente não ficar fora da cascata.
//
// O lado das automações não tinha equivalente: `conversionFlow` montava o par à
// mão. Isto existe para que a próxima porta — **um comentário que aprova**, que
// consta como pendência em docs/reporting/decisoes.md — chame uma função em vez
// de virar uma segunda implementação da mesma regra. Duas implementações de
// "aprovar" divergem; foi assim que "avançar o molde" divergiu em dois caminhos e
// custou quatro clientes em 21/09/2026.

import type { TaskRecord, TaskStatus } from "@/lib/validation";
import { transitionTaskStatus } from "@/lib/automations/taskWrites";
import type { AdminClient } from "@/lib/automations/taskAccess";
import { advanceFlowAfterUpdate } from "./advance";

/** Os estados de onde uma etapa aberta pode ser aprovada. `aprovacao` entra:
 *  uma etapa esperando aprovação é exatamente o caso. */
export const APPROVABLE_FROM: readonly TaskStatus[] = ["backlog", "em_producao", "revisao", "aprovacao"];

export type ApproveOptions = {
  /** Quem aprovou. Vai para a cascata, que usa para não notificar o próprio
   *  autor da ação — a cascata roda com service role, onde `auth.uid()` é nulo. */
  actorId?: string | null;
  /** Restringe a origem. O padrão cobre toda etapa aberta. */
  from?: readonly TaskStatus[];
};

/**
 * Aprova `task` e dispara a cascata. Devolve a tarefa atualizada, ou `null`
 * quando o compare-and-set não pegou — porque alguém já a concluiu, ou porque ela
 * não estava num estado aprovável. `null` NÃO é erro: é "alguém chegou antes".
 *
 * `open: true` garante que uma tarefa já concluída não é reaberta por uma
 * aprovação atrasada.
 */
export async function approveTask(
  admin: AdminClient,
  task: TaskRecord,
  options: ApproveOptions = {},
): Promise<TaskRecord | null> {
  const approved = await transitionTaskStatus(admin, task.id, {
    to: "aprovado",
    from: options.from ?? APPROVABLE_FROM,
    open: true,
  });
  if (!approved) return null;
  // A cascata nunca lança (ver advanceFlowAfterUpdate): uma falha ao criar a
  // etapa seguinte não pode desfazer a aprovação que acabou de acontecer — ela
  // aparece como comentário no card.
  await advanceFlowAfterUpdate(task, approved, options.actorId ?? null);
  return approved;
}
