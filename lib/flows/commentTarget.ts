// ONDE um comentário feito num card de entrega é gravado — a regra completa,
// em um lugar só, para as duas portas de comentário responderem a mesma coisa.
//
// A regra (P1-D): comentar no card PAI grava na ETAPA CORRENTE, não no pai.
// "Se o card estiver em edição, o comentário feito no pai comenta no card de
// edição." A LEITURA do thread não muda — mergeFamilyComments já junta a
// família inteira no pai — só o destino da ESCRITA.
//
// Existe como módulo próprio porque há DUAS portas de comentário, e elas já
// divergiram uma vez: `app/api/admin/tasks/[id]/comments/route.ts` (o admin,
// via RPC append_task_comment) e `app/api/client/[slug]/tasks/[id]/route.ts`
// (o cliente, "Aprovar entrega"/"Solicitar ajustes", que monta
// `payload.comments` à mão). Com a regra escrita só do lado do admin, o mesmo
// comentário caía em cards diferentes conforme quem o escreveu — e o caso não
// é hipotético: `deliveryStatusOnFinish` coloca a PRÓPRIA entrega em
// `aprovacao` quando o cliente é aprovador e não há revisor, então é
// exatamente numa entrega que o cliente clica "Solicitar ajustes".
//
// Sempre com o client de SERVIÇO: um dos chamadores é uma sessão de cliente, e
// uma conta cliente não enxerga as etapas (a etapa raramente é
// `client_visible`, e a política "task links client read" exige que o pai
// seja). Ler os elos com a sessão do próprio cliente devolveria uma corrente
// vazia e o desvio silenciosamente não aconteceria. Mesmo precedente de
// lib/flows/advance.ts, que roda com o client de serviço pela mesma razão.

import { TASK_COLUMNS } from "@/lib/taskColumns";
import { asTaskRecord, type AdminClient } from "@/lib/automations/taskAccess";
import { isFlowDelivery, stepOrderOf } from "@/lib/taskRelations";
import type { TaskRecord } from "@/lib/validation";
import { currentFlowStepOf } from "./currentStep";

/** As etapas de uma entrega, na ordem da corrente, lidas com o client de
 * serviço. A ordem vem do `position` do ELO, não da posição do card no quadro
 * — mesma razão documentada em `stepOrderOf`: um card avulso ligado à mão como
 * etapa chega com a posição que já tinha no Kanban e se enfiaria na frente do
 * roteiro. */
async function adminFlowStepsOf(admin: AdminClient, deliveryId: string): Promise<TaskRecord[]> {
  const { data: links, error: linksError } = await admin
    .from("task_links")
    .select("child_id,slot,position")
    .eq("parent_id", deliveryId)
    .not("slot", "is", null);
  if (linksError) throw linksError;
  const rows = (links ?? []) as { child_id: string; slot: string | null; position: number | null }[];
  if (!rows.length) return [];

  const { data: steps, error: stepsError } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .in("id", rows.map((r) => r.child_id));
  if (stepsError) throw stepsError;

  const parents = new Map(rows.map((r) => [r.child_id, [{ id: deliveryId, slot: r.slot, position: r.position ?? 0 }]]));
  return (steps ?? [])
    .map((row) => ({ ...asTaskRecord(row), parents: parents.get((row as { id: string }).id) ?? [] }))
    .sort((a, b) => stepOrderOf(a, deliveryId) - stepOrderOf(b, deliveryId));
}

/**
 * O card que de fato recebe um comentário escrito em `task`.
 *
 * - `task` não é uma entrega (tarefa comum, etapa, Plano de Ação): o próprio
 *   card. Plano de Ação fica de fora de propósito — ali o comentário continua
 *   no plano; um plano não tem "etapa corrente", tem atividades paralelas.
 * - `task` é uma entrega com corrente: a etapa corrente
 *   (`currentFlowStepOf` — a primeira sem `completed_at`, ou a última quando
 *   tudo terminou).
 * - `task` é uma entrega ainda SEM etapa nenhuma (recém-criada, esperando
 *   `materializeFirstStep`): a própria entrega. Não há para onde desviar, e
 *   perder o comentário seria pior do que gravá-lo no pai.
 */
export async function flowCommentTargetId(admin: AdminClient, task: TaskRecord): Promise<string> {
  if (!isFlowDelivery(task)) return task.id;
  const steps = await adminFlowStepsOf(admin, task.id);
  return currentFlowStepOf(steps)?.id ?? task.id;
}
