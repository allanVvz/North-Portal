// ONDE um comentário feito num card de entrega é gravado — a regra completa,
// em um lugar só, para as duas portas de comentário responderem a mesma coisa.
//
// A regra base (P1-D): comentar no card PAI grava na ETAPA CORRENTE, não no
// pai. "Se o card estiver em edição, o comentário feito no pai comenta no
// card de edição." A LEITURA do thread não muda — mergeFamilyComments já
// junta a família inteira no pai — só o destino da ESCRITA.
//
// Regra de papel (2026-09-12, por cima da base): quando quem comenta tem um
// PAPEL numa etapa aberta específica, o comentário cai nela em vez de na
// corrente pura por posição — é assim que "captação ainda aberta, edição já
// em revisão" deixa de desviar o comentário pra etapa errada (o card que
// motivou esta regra: edição tem revisor próprio, mas a corrente por posição
// apontava pra captação). Precedência, entre as etapas ABERTAS:
//   1. Existe uma etapa em `status: 'revisao'` cujo `reviewer_id` é quem
//      comentou? Ela vence — revisor tem prioridade sobre responsável.
//   2. Senão, existe uma etapa (a mais antiga por posição, se houver mais de
//      uma) onde quem comentou está entre os `task_assignees` vinculados?
//      Ela vence.
//   3. Senão, cai no fallback de sempre: `currentFlowStepOf` (a mais antiga
//      etapa aberta por posição).
// Identidade sempre por vínculo ESTRUTURADO (`reviewer_id`, `task_assignees`)
// — nunca pelo texto livre do campo `assignee`; quem só tem nome digitado à
// mão nunca aciona esta regra, cai direto no fallback.
//
// Existe como módulo próprio porque há DUAS portas de comentário, e elas já
// divergiram uma vez: `app/api/admin/tasks/[id]/comments/route.ts` (o admin,
// via RPC append_task_comment) e `app/api/client/[slug]/tasks/[id]/route.ts`
// (o cliente, "Aprovar entrega"/"Solicitar ajustes", que monta
// `payload.comments` à mão). Com a regra escrita só do lado do admin, o mesmo
// comentário caía em cards diferentes conforme quem o escreveu. A rota de
// cliente recusa alteração da Entrega-pai; este resolvedor ainda protege links
// antigos, fazendo o comentário cair na etapa corrente. Um cliente nunca é
// revisor/responsável vinculado de uma etapa interna, então a regra de papel
// nunca dispara nessa porta — cai sempre no fallback, sem regressão.
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
    .eq("relation_kind", "workflow_step");
  if (linksError) throw linksError;
  const rows = (links ?? []) as { child_id: string; slot: string | null; position: number | null }[];
  if (!rows.length) return [];

  const { data: steps, error: stepsError } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .in("id", rows.map((r) => r.child_id));
  if (stepsError) throw stepsError;

  const parents = new Map(rows.map((r) => [r.child_id, [{ id: deliveryId, relation_kind: "workflow_step" as const, slot: r.slot, position: r.position ?? 0 }]]));
  return (steps ?? [])
    .map((row) => ({ ...asTaskRecord(row), parents: parents.get((row as { id: string }).id) ?? [] }))
    .sort((a, b) => stepOrderOf(a, deliveryId) - stepOrderOf(b, deliveryId));
}

/** Os responsáveis vinculados (`task_assignees`, por id de perfil) de cada
 * etapa, numa única busca em lote — nunca uma por etapa. As etapas chegam via
 * `asTaskRecord` (sem join, `assignee_profile_ids` sempre `[]`, ver
 * lib/automations/taskAccess.ts), então este é o único jeito de saber quem
 * está vinculado a cada uma aqui dentro. */
async function adminTaskAssigneesOf(admin: AdminClient, stepIds: string[]): Promise<Map<string, Set<string>>> {
  const byStep = new Map<string, Set<string>>();
  if (!stepIds.length) return byStep;
  const { data, error } = await admin.from("task_assignees").select("task_id,profile_id").in("task_id", stepIds);
  if (error) throw error;
  for (const row of (data ?? []) as { task_id: string; profile_id: string }[]) {
    const set = byStep.get(row.task_id) ?? new Set<string>();
    set.add(row.profile_id);
    byStep.set(row.task_id, set);
  }
  return byStep;
}

/**
 * O card que de fato recebe um comentário escrito em `task`.
 *
 * - `task` não é uma entrega (tarefa comum, etapa, Plano de Ação): o próprio
 *   card. Plano de Ação fica de fora de propósito — ali o comentário continua
 *   no plano; um plano não tem "etapa corrente", tem atividades paralelas.
 * - `task` é uma entrega com corrente e `commenterId` tem um papel numa etapa
 *   ABERTA específica: essa etapa vence (ver a regra de papel no cabeçalho do
 *   módulo) — revisor de uma etapa em revisão primeiro, responsável vinculado
 *   depois.
 * - Senão, `task` é uma entrega com corrente: a etapa corrente
 *   (`currentFlowStepOf` — a mais antiga sem `completed_at`, ou a última
 *   quando tudo terminou).
 * - `task` é uma entrega ainda SEM etapa nenhuma (recém-criada, esperando
 *   `materializeFirstStep`): a própria entrega. Não há para onde desviar, e
 *   perder o comentário seria pior do que gravá-lo no pai.
 *
 * `commenterId` é o id de perfil de quem está comentando — `null`/omitido
 * pula direto pro fallback (ex.: um caminho que não sabe quem comentou).
 */
export async function flowCommentTargetId(
  admin: AdminClient,
  task: TaskRecord,
  commenterId: string | null = null,
): Promise<string> {
  if (!isFlowDelivery(task)) return task.id;
  const steps = await adminFlowStepsOf(admin, task.id);

  if (commenterId) {
    const openSteps = steps.filter((step) => !step.completed_at);
    const assigneesByStep = await adminTaskAssigneesOf(admin, openSteps.map((step) => step.id));

    const reviewerStep = openSteps.find((step) => step.status === "revisao" && step.reviewer_id === commenterId);
    if (reviewerStep) return reviewerStep.id;

    const assigneeStep = openSteps.find((step) => assigneesByStep.get(step.id)?.has(commenterId));
    if (assigneeStep) return assigneeStep.id;
  }

  return currentFlowStepOf(steps)?.id ?? task.id;
}
