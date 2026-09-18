// ONDE um comentário feito numa entrega é gravado — a regra completa, em um
// lugar só, para as duas portas de comentário responderem a mesma coisa.
//
// A Entrega é o contêiner visual; as tarefas filhas (etapas) são a fonte de
// verdade dos comentários. Comentar "na Entrega" nunca grava no pai e nunca
// replica o texto em pai e filho: a leitura junta a família
// (`mergeFamilyComments`), a ESCRITA vai para uma etapa só.
//
// Precedência (a primeira que se aplica vence):
//   1. `stageTaskId` explícito — a interface diz qual etapa mostrava como corrente.
//      Precisa ser uma etapa (`workflow_step`) DESTA entrega; senão 409
//      COMMENT_STAGE_INVALID. Nunca é escolhido pelo nome textual da etapa. Se a
//      etapa informada já foi concluída e a Entrega avançou (tela desatualizada),
//      o comentário vai para a etapa aberta AGORA (via `stage_advanced`): o banco
//      garante uma única etapa aberta por Entrega, em ordem.
//   2. O card não é uma entrega (tarefa comum, etapa, Plano de Ação): o próprio
//      card. Plano de Ação fica de fora de propósito — ali o comentário continua
//      no plano; um plano não tem "etapa corrente", tem atividades paralelas.
//   3. Sem `stageTaskId` (chamadas antigas), só se houver UMA etapa atual
//      inequívoca:
//        - nenhuma etapa ainda (recém-criada, esperando `materializeFirstStep`):
//          a própria entrega — não há para onde desviar;
//        - todas concluídas: a última (a corrente nunca "acaba");
//        - exatamente uma aberta: ela;
//        - várias abertas: o PAPEL de quem comentou desambigua, e só se apontar
//          exatamente uma — revisor de etapa em `revisao` primeiro, responsável
//          vinculado (`task_assignees`, nunca o texto livre `assignee`) depois.
//   4. Ainda ambíguo: 409 COMMENT_STAGE_AMBIGUOUS com os ids candidatos. Gravar
//      numa tarefa arbitrária é pior do que pedir que a interface diga a etapa.
//
// Existe como módulo próprio porque há DUAS portas de comentário, e elas já
// divergiram uma vez: `app/api/admin/tasks/[id]/comments/route.ts` (o admin,
// via RPC append_task_comment_idempotent) e `app/api/client/[slug]/tasks/[id]/route.ts`
// (o cliente, "Aprovar entrega"/"Solicitar ajustes", que monta
// `payload.comments` à mão). A rota de cliente recusa alteração da
// Entrega-pai; este resolvedor ainda protege links antigos, fazendo o comentário
// cair na etapa corrente. Um cliente nunca é revisor/responsável vinculado de
// uma etapa interna, então a regra de papel nunca dispara nessa porta.
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
import { HttpError, type TaskRecord } from "@/lib/validation";
import { currentFlowStepOf } from "./currentStep";

export const COMMENT_STAGE_INVALID = "COMMENT_STAGE_INVALID";
export const COMMENT_STAGE_AMBIGUOUS = "COMMENT_STAGE_AMBIGUOUS";

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

export type CommentTargetVia =
  | "explicit"
  | "stage_advanced"
  | "own"
  | "no_steps"
  | "last_completed"
  | "sole_open"
  | "reviewer"
  | "assignee";

export type CommentTarget = { targetId: string; via: CommentTargetVia };

function ambiguous(deliveryId: string, candidates: TaskRecord[]): HttpError {
  return new HttpError(
    409,
    "Esta entrega tem mais de uma etapa aberta. Escreva o comentário dentro da etapa desejada.",
    { code: COMMENT_STAGE_AMBIGUOUS, delivery_id: deliveryId, candidates: candidates.map((step) => step.id) },
  );
}

/**
 * O card que de fato recebe um comentário escrito em `task`, e por qual regra.
 *
 * `commenterId` é o id de perfil de quem está comentando — `null`/omitido pula
 * a regra de papel (ex.: um caminho que não sabe quem comentou).
 * `stageTaskId` é a etapa que a interface informou.
 *
 * Lança `HttpError` 409 (com `details.code`) quando a etapa informada não
 * pertence à entrega ou quando o destino é ambíguo.
 */
export async function resolveFlowCommentTarget(
  admin: AdminClient,
  task: TaskRecord,
  options: { commenterId?: string | null; stageTaskId?: string | null } = {},
): Promise<CommentTarget> {
  const { commenterId = null, stageTaskId = null } = options;

  if (!isFlowDelivery(task)) {
    if (stageTaskId && stageTaskId !== task.id) {
      throw new HttpError(409, "Essa etapa não pertence a este card. Atualize a página e tente de novo.", { code: COMMENT_STAGE_INVALID, stage_task_id: stageTaskId });
    }
    return { targetId: task.id, via: "own" };
  }

  const steps = await adminFlowStepsOf(admin, task.id);

  if (stageTaskId) {
    const chosen = steps.find((step) => step.id === stageTaskId);
    if (!chosen) {
      throw new HttpError(409, "Essa etapa não pertence a esta entrega. Atualize a página e tente de novo.", { code: COMMENT_STAGE_INVALID, stage_task_id: stageTaskId, delivery_id: task.id });
    }
    // A tela manda a etapa que mostrava como corrente. Se ela já foi concluída e a
    // Entrega avançou (outra aba, o cliente aprovando no portal, a conclusão logo
    // antes de o comentário sair), o comentário é da etapa de AGORA: a Entrega tem
    // sempre uma única etapa aberta, e comentar "na Entrega" é comentar nela.
    if (chosen.completed_at) {
      const open = steps.filter((step) => !step.completed_at);
      if (open.length === 1) return { targetId: open[0].id, via: "stage_advanced" };
    }
    return { targetId: stageTaskId, via: "explicit" };
  }

  if (!steps.length) return { targetId: task.id, via: "no_steps" };

  const openSteps = steps.filter((step) => !step.completed_at);
  if (!openSteps.length) return { targetId: currentFlowStepOf(steps)!.id, via: "last_completed" };
  if (openSteps.length === 1) return { targetId: openSteps[0].id, via: "sole_open" };

  if (commenterId) {
    const reviewerSteps = openSteps.filter((step) => step.status === "revisao" && step.reviewer_id === commenterId);
    if (reviewerSteps.length === 1) return { targetId: reviewerSteps[0].id, via: "reviewer" };
    if (reviewerSteps.length > 1) throw ambiguous(task.id, reviewerSteps);

    const assigneesByStep = await adminTaskAssigneesOf(admin, openSteps.map((step) => step.id));
    const assigneeSteps = openSteps.filter((step) => assigneesByStep.get(step.id)?.has(commenterId));
    if (assigneeSteps.length === 1) return { targetId: assigneeSteps[0].id, via: "assignee" };
    if (assigneeSteps.length > 1) throw ambiguous(task.id, assigneeSteps);
  }

  throw ambiguous(task.id, openSteps);
}

/** Só o id do destino — para os chamadores que não precisam saber a regra. */
export async function flowCommentTargetId(
  admin: AdminClient,
  task: TaskRecord,
  commenterId: string | null = null,
  stageTaskId: string | null = null,
): Promise<string> {
  return (await resolveFlowCommentTarget(admin, task, { commenterId, stageTaskId })).targetId;
}
