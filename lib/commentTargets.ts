// Para qual card vai um comentário, e o que cada pessoa tem para decidir.
//
// A coluna de comentários do modal mostra UMA linha de destino ("→ Não é Todo
// Mundo · Edição") e, para quem revisa, Aprovar / Solicitar revisão — um card
// por vez, na ordem do plano. Este módulo é a leitura única dessa ordem e do
// endpoint de cada destino; o modal não monta URL nem corpo à mão.
//
// Ordem:
//   - Plano: a nota do plano e os membros na ordem da lista; dentro de uma
//     Entrega, as etapas na ordem do fluxo, com o andamento DESTA Entrega
//     (`flowStepsOf` → `stageInDelivery`); um plano dentro do plano é
//     percorrido do mesmo jeito.
//   - Entrega: as etapas, em ordem.
//   - Qualquer outro card: ele mesmo. Uma etapa aberta direto leva a Entrega
//     de contexto quando ela é uma só (o andamento e a decisão são por Entrega).
//
// Endpoints (o servidor revalida tudo; ver lib/flows/commentTarget.ts):
//   - etapa de uma Entrega → POST na ENTREGA com `stage_task_id`. É assim que
//     o comentário ganha a marca da Entrega (`for_task_id`) e aparece na
//     conversa dela e do plano. Enviado pelo plano, a marca seria o id do
//     plano, que não é contexto de nenhuma etapa, e a projeção da conversa
//     (lib/cardConversation.ts) esconderia o comentário.
//   - nota do plano → POST no plano com `plan_note`.
//   - o próprio card → POST nele, sem marca (como sempre foi).
//   - decisão → POST /review-decision no card decidido, com `delivery_id`
//     quando o andamento é por Entrega.

import { actionPlanMembersOf, flowStepsOf, isFlowDelivery, stageInDelivery } from "./taskRelations";
import { reviewerIdsOf } from "./flows/stepRole";
import { subtypeLabel } from "./taskCatalog";
import type { TaskRecord } from "./validation";

export type CommentTarget = {
  /** Único na lista: a mesma etapa pode servir duas Entregas do plano. */
  key: string;
  /** O card que recebe o comentário e a decisão (etapa, membro ou o plano). */
  card: TaskRecord;
  /** A Entrega de contexto da etapa, ou null. */
  deliveryId: string | null;
  /** "Não é Todo Mundo · Edição"; dentro da própria Entrega, só "Edição". */
  label: string;
  /** Onde o POST do comentário é feito e com que corpo. */
  post: { taskId: string; stageTaskId?: string; planNote?: true };
};

export type ReviewDecision = "approve" | "request_changes";

const stepName = (step: TaskRecord) => subtypeLabel(step.subtype ?? "") || step.title;

export function isPlanRoot(card: Pick<TaskRecord, "kind" | "recurrence_cadence">): boolean {
  return card.kind === "plano_acao" && !card.recurrence_cadence;
}

export function planNoteTarget(plan: TaskRecord): CommentTarget {
  return { key: `plan-note:${plan.id}`, card: plan, deliveryId: null, label: "Nota do plano", post: { taskId: plan.id, planNote: true } };
}

function deliverySteps(delivery: TaskRecord, tasks: readonly TaskRecord[], labelPrefix: string): CommentTarget[] {
  const steps = flowStepsOf(delivery.id, tasks);
  // Mesma regra do servidor (resolveFlowCommentTarget): com UMA etapa aberta,
  // uma concluída é recusada como "a etapa mudou". Nem entra na lista.
  const open = steps.filter((step) => !step.completed_at);
  const accepted = open.length === 1 ? open : steps;
  return accepted.map((step) => ({
    key: `${step.id}@${delivery.id}`,
    card: step,
    deliveryId: delivery.id,
    label: labelPrefix ? `${labelPrefix} · ${stepName(step)}` : stepName(step),
    post: { taskId: delivery.id, stageTaskId: step.id },
  }));
}

/** Todos os destinos possíveis a partir de `root`, na ordem em que aparecem. */
export function commentTargetsOf(
  root: TaskRecord,
  tasks: readonly TaskRecord[],
  options: { contextDeliveryId?: string | null } = {},
): CommentTarget[] {
  if (isFlowDelivery(root)) {
    const steps = deliverySteps(root, tasks, "");
    return steps.length ? steps : [ownTarget(root, null)];
  }
  if (!isPlanRoot(root)) return [ownTarget(root, options.contextDeliveryId ?? null)];
  const out: CommentTarget[] = [planNoteTarget(root)];
  const seen = new Set<string>([root.id]);
  const visit = (planId: string, depth: number) => {
    for (const member of actionPlanMembersOf(planId, tasks)) {
      if (seen.has(member.id) || depth > 5) continue;
      seen.add(member.id);
      if (member.kind === "plano_acao") { visit(member.id, depth + 1); continue; }
      const steps = isFlowDelivery(member) ? deliverySteps(member, tasks, member.title) : [];
      if (steps.length) out.push(...steps);
      else out.push({ key: member.id, card: member, deliveryId: null, label: member.title, post: { taskId: member.id } });
    }
  };
  visit(root.id, 0);
  return out;
}

function ownTarget(card: TaskRecord, deliveryId: string | null): CommentTarget {
  return {
    key: card.id,
    card: deliveryId ? stageInDelivery(card, deliveryId) : card,
    deliveryId,
    label: card.title,
    post: { taskId: card.id },
  };
}

/** `userId` pode decidir este destino agora: está em Revisão e a pessoa é revisora. */
export function canDecide(target: CommentTarget, userId: string | null | undefined): boolean {
  if (!userId || target.post.planNote) return false;
  return target.card.status === "revisao" && reviewerIdsOf(target.card).includes(userId);
}

/** O que `userId` tem para decidir, na ordem dos destinos. */
export function reviewQueueOf(targets: readonly CommentTarget[], userId: string | null | undefined): CommentTarget[] {
  return targets.filter((target) => canDecide(target, userId));
}

export function commentRequestOf(target: CommentTarget, fields: { text: string; commentId: string; assetIds?: readonly string[] }) {
  return {
    url: `/api/admin/tasks/${target.post.taskId}/comments`,
    body: {
      text: fields.text,
      comment_id: fields.commentId,
      ...(target.post.stageTaskId ? { stage_task_id: target.post.stageTaskId } : {}),
      ...(target.post.planNote ? { plan_note: true } : {}),
      ...(fields.assetIds?.length ? { asset_ids: [...fields.assetIds] } : {}),
    },
  };
}

export function reviewDecisionRequestOf(target: CommentTarget, decision: ReviewDecision, requestId: string) {
  return {
    url: `/api/admin/tasks/${target.card.id}/review-decision`,
    body: {
      decision,
      expected_status: "revisao" as const,
      ...(target.deliveryId ? { delivery_id: target.deliveryId } : {}),
      request_id: requestId,
    },
  };
}
