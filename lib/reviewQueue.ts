// Para onde vai um comentário e o que cada pessoa tem para revisar (30/09).
//
// O campo de comentário deixou de ter seletores. Ele mostra UMA linha de
// destino e, para quem revisa, dois botões — Aprovar e Solicitar revisão —,
// um card por vez, em ordem. Esta é a leitura única dessa ordem:
//   - Plano: os membros na ordem da lista; dentro de uma Entrega, as etapas
//     na ordem do fluxo (com o andamento DESTA Entrega, `stageInDelivery`);
//     um plano dentro do plano é percorrido do mesmo jeito.
//   - Entrega: as etapas, em ordem.
//   - Qualquer outro card: ele mesmo.
// A fila de revisão são os destinos em Revisão em que a pessoa é revisora.

import { actionPlanMembersOf, flowStepsOf, isFlowDelivery } from "./taskRelations";
import { reviewerIdsOf } from "./flows/stepRole";
import { subtypeLabel } from "./taskCatalog";
import type { TaskRecord } from "./validation";

export type CommentTarget = {
  card: TaskRecord;
  /** A Entrega a que esta etapa pertence (andamento por Entrega), ou null. */
  deliveryId: string | null;
  /** "Não é Todo Mundo · Edição" */
  label: string;
};

const stepName = (step: TaskRecord) => subtypeLabel(step.subtype ?? "") || step.title;

export function commentTargetsOf(root: TaskRecord, tasks: readonly TaskRecord[]): CommentTarget[] {
  if (isFlowDelivery(root)) {
    return flowStepsOf(root.id, tasks).map((step) => ({ card: step, deliveryId: root.id, label: `${root.title} · ${stepName(step)}` }));
  }
  if (root.kind !== "plano_acao" || root.recurrence_cadence) return [{ card: root, deliveryId: null, label: root.title }];
  const out: CommentTarget[] = [];
  const seen = new Set<string>([root.id]);
  const visit = (planId: string, depth: number) => {
    for (const member of actionPlanMembersOf(planId, tasks)) {
      if (seen.has(member.id) || depth > 5) continue;
      seen.add(member.id);
      if (member.kind === "plano_acao") { visit(member.id, depth + 1); continue; }
      if (isFlowDelivery(member)) {
        for (const step of flowStepsOf(member.id, tasks)) out.push({ card: step, deliveryId: member.id, label: `${member.title} · ${stepName(step)}` });
        continue;
      }
      out.push({ card: member, deliveryId: null, label: member.title });
    }
  };
  visit(root.id, 0);
  return out;
}

/** O que `userId` tem para revisar dentro de `root`, na ordem. */
export function reviewQueueOf(root: TaskRecord, tasks: readonly TaskRecord[], userId: string | null | undefined): CommentTarget[] {
  if (!userId) return [];
  return commentTargetsOf(root, tasks).filter(({ card }) => card.status === "revisao" && reviewerIdsOf(card).includes(userId));
}

/** Relatório da automação: "Solicitar revisão" é um pedido interpretado e regerado, não uma volta de status. */
export function isReportStep(card: Pick<TaskRecord, "subtype">): boolean {
  return card.subtype === "relatorio_anuncios" || card.subtype === "relatorio_conversao";
}
