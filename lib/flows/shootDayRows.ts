// Diária de gravação: UM roteiro e UMA captação compartilhados por várias
// publicações, cada uma com a sua edição e a sua publicação.
//
// A roteirista escreve todos os roteiros de uma diária num documento só, e a
// diária gera várias peças (na maioria Reels; às vezes carrossel, banner,
// story). No fluxo comum cada Entrega teria o seu roteiro e a sua captação —
// repetidos por peça. Aqui cada peça é uma Entrega normal, mas os slots
// `roteiro` e `captacao` de TODAS apontam para os mesmos dois cards.
//
// Isso funciona com o motor de cascata sem mudança nenhuma
// (lib/flows/advance.ts):
//   - `task_links` tem PK (parent_id, child_id), então um card pode ocupar a
//     etapa de várias entregas;
//   - `advanceFlow` percorre TODOS os pais da etapa concluída;
//   - `advanceOneDelivery` não cria nada quando o slot seguinte já está
//     ocupado — concluir o roteiro não duplica a captação, e concluir a
//     captação cria a edição de cada peça.
//
// Puro de propósito (sem IO): os ids das entregas vêm de fora, então o
// resultado inteiro — linhas e elos — é testável sem banco.

import type { TaskRecord } from "@/lib/validation";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { flowStepFields } from "./stepFields";

export type ShootDayPiece = {
  title: string;
  /** Valor de `payload.formato` (FORMATO_OPTIONS). */
  formato: string;
  /** Data prevista de publicação — vira o prazo da entrega. */
  publishDate: string | null;
  description?: string | null;
};

export type ShootDayRowsInput = {
  clientId: string | null;
  type: TaskTypeDef;
  shootDate: string;
  today: string;
  scriptTitle: string;
  scriptDescription: string | null;
  captureTitle: string;
  pieces: ShootDayPiece[];
  assignee: string | null;
  deliveryIds: string[];
};

export type ShootDayLink = { parentId: string; childId: string; workflowStepId: string; slot: string; position: number };

export type ShootDayRows = {
  deliveries: Record<string, unknown>[];
  roteiro: Record<string, unknown>;
  captacao: Record<string, unknown>;
  links: ShootDayLink[];
};

/** Quantos dias antes da gravação o roteiro vence (jornada: roteirização D-4). */
export const SCRIPT_LEAD_DAYS = 4;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shootDayRows(input: ShootDayRowsInput): ShootDayRows {
  const { type, pieces } = input;
  if (!pieces.length) throw new Error("A diária precisa de pelo menos uma publicação.");
  if (input.deliveryIds.length !== pieces.length) throw new Error("Cada publicação precisa de um id de entrega.");
  const roteiroStep = type.subtypes.find((step) => step.key === "roteiro");
  const captacaoStep = type.subtypes.find((step) => step.key === "captacao");
  if (!roteiroStep || !captacaoStep) {
    throw new Error(`O tipo ${type.label} não tem as etapas de roteiro e captação — a diária precisa das duas.`);
  }
  if (!type.workflow_version_id) throw new Error(`O tipo ${type.label} não tem uma versão publicada.`);

  const deliveries = pieces.map((piece, index) => ({
    id: input.deliveryIds[index],
    title: piece.title,
    description: piece.description ?? null,
    kind: type.key,
    subtype: null,
    task_type_id: type.id,
    workflow_version_id: type.workflow_version_id,
    workflow_activated_at: null,
    plan_id: null,
    status: "backlog",
    priority: "media",
    assignee: input.assignee,
    due_date: piece.publishDate,
    start_date: input.today,
    end_date: piece.publishDate,
    recurrence_cadence: null,
    recurrence_weekdays: [],
    recurrence_day_of_month: null,
    payload: {
      formato: piece.formato,
    },
  }));

  // As etapas compartilhadas herdam da primeira entrega (cliente, tipo,
  // revisor) e ficam com o id determinístico dela — o mesmo que a cascata
  // calcularia, então um reprocessamento colide em vez de duplicar.
  const anchor = {
    ...deliveries[0],
    client_id: input.clientId,
    reviewer_id: null,
    approver_id: null,
    requires_review: false,
    requires_approval: false,
  } as unknown as TaskRecord;

  const scriptDue = addDays(input.shootDate, -SCRIPT_LEAD_DAYS);
  const roteiroFields = flowStepFields(anchor, roteiroStep, null, input.today);
  const roteiro: Record<string, unknown> = {
    ...roteiroFields,
    title: input.scriptTitle,
    description: input.scriptDescription,
    assignee: roteiroStep.default_assignee || input.assignee || roteiroFields.assignee,
    due_date: scriptDue < input.today ? input.today : scriptDue,
  };

  const captacaoFields = flowStepFields(anchor, captacaoStep, null, input.today);
  const captacao: Record<string, unknown> = {
    ...captacaoFields,
    title: input.captureTitle,
    assignee: captacaoStep.default_assignee || input.assignee || captacaoFields.assignee,
    // A gravação tem data marcada: é o dia da diária, não "hoje + prazo da etapa".
    due_date: input.shootDate,
    start_date: input.shootDate,
  };

  const links = deliveries.flatMap((delivery) => [
    { parentId: delivery.id, childId: String(roteiro.id), workflowStepId: roteiroStep.workflow_step_id!, slot: roteiroStep.key, position: roteiroStep.order_index },
    { parentId: delivery.id, childId: String(captacao.id), workflowStepId: captacaoStep.workflow_step_id!, slot: captacaoStep.key, position: captacaoStep.order_index },
  ]);

  return { deliveries, roteiro, captacao, links };
}
