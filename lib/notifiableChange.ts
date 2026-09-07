// O que, num salvamento de card, merece virar notificação — e para quem.
//
// Antes, a rota de PATCH decidia assim (app/api/admin/tasks/[id]/route.ts):
// "mudou o status? avisa status. senão, avisa que o card foi editado". Sem
// condição, no fim de TODO salvamento. Três consequências que a caixa de
// entrada de todo mundo mostrava:
//
//   1. Arrastar um card no quadro manda um PATCH por card RENUMERADO
//      (KanbanBoard, OperacaoWorkspace). Os vizinhos, que ninguém tocou,
//      avisavam "foi editado" para todos os participantes deles.
//   2. `patchWithTopPosition` (lib/supabase.ts) injeta um `position` novo em
//      todo PATCH que não mande um. Ou seja, `position` muda em quase toda
//      escrita — e é por isso que um diff genérico do objeto não serve:
//      ele notificaria 100% dos salvamentos.
//   3. "Foi editado" não diz o que mudou, então mesmo a notificação legítima
//      obrigava a abrir o card para descobrir o motivo.
//
// Este módulo é a decisão, e é puro: nenhum IO, nenhum import de servidor.
// Mora fora de lib/notifications.ts porque aquele importa ./supabase/server →
// next/headers, e um módulo server-only não pode ser testado nem importado do
// cliente. Mesmo motivo pelo qual lib/notificationTypes.ts já existe separado.

import type { NotificationType } from "./notificationTypes";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDateBR(value: string): string {
  const m = DATE_ONLY_RE.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

// Rótulo curto do status para a mensagem. Deliberadamente sem o prefixo
// "Kanban ·" que STATUS_KANBAN usa em lib/supabase.ts: ali o contexto é a
// coluna do quadro, aqui é uma frase.
const STATUS_LABEL: Record<string, string> = {
  backlog: "Entrada",
  em_producao: "Em produção",
  revisao: "Revisão",
  aprovacao: "Aprovação",
  // `aprovado` é o estágio final agora, e o quadro o chama de "Concluído".
  // Dizer "mudou para Aprovado" numa notificação enquanto a coluna diz
  // "Concluído" é a mesma coisa com dois nomes.
  aprovado: "Concluído",
  // Legado: `concluido` saiu do vocabulário, mas uma notificação antiga ainda
  // pode carregar a string. Melhor resolver do que mostrar a chave crua.
  concluido: "Concluído",
  parada: "Parada",
};

export function dueSoonMessage(title: string, dueDate: string): string {
  return `Prazo próximo: "${title}" vence em ${formatDateBR(dueDate)}.`;
}

export function statusChangedMessage(title: string, status: string): string {
  return `"${title}" mudou para ${STATUS_LABEL[status] ?? status}.`;
}

export function taskCreatedMessage(title: string): string {
  return `"${title}" foi criado.`;
}

export function taskCommentedMessage(title: string, author: string): string {
  return `${author} comentou em "${title}".`;
}

/** "foi editado" sozinho obrigava a abrir o card para saber o motivo. Com os
 * campos nomeados, a linha da caixa de entrada já responde. */
export function taskUpdatedMessage(title: string, fields: readonly string[] = []): string {
  if (!fields.length) return `"${title}" foi editado.`;
  return `"${title}": ${joinPt(fields)} ${fields.length === 1 ? "alterado" : "alterados"}.`;
}

export function dueChangedMessage(title: string, fields: readonly string[], newDate: string | null): string {
  const what = joinPt(fields);
  return newDate ? `"${title}": ${what} para ${formatDateBR(newDate)}.` : `"${title}": ${what} removido.`;
}

export function assignedMessage(title: string, role: AssignedRole): string {
  const label = role === "responsavel" ? "responsável" : role === "revisor" ? "revisor" : "aprovador";
  return `Você virou ${label} de "${title}".`;
}

function joinPt(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// As listas — é aqui que mora a decisão
// ---------------------------------------------------------------------------

/** Campos que NUNCA geram notificação, em nenhuma combinação.
 *
 * `position` é o mais importante: além de ser o arrasto do quadro, ele muda
 * sozinho em quase todo PATCH por causa do `patchWithTopPosition`.
 * `completed_at` é derivado de `status` por trigger — contá-lo seria a mesma
 * mudança avisada duas vezes. */
const IGNORED_FIELDS = ["id", "position", "updated_at", "created_at", "created_by", "completed_at"] as const;

const DATE_FIELDS = [
  { key: "due_date", label: "prazo" },
  { key: "start_date", label: "início" },
  { key: "end_date", label: "fim" },
  { key: "scheduled_start_at", label: "horário" },
  { key: "scheduled_end_at", label: "horário de término" },
] as const;

/** Conteúdo do card. O usuário escolheu: título, descrição, prioridade e
 * "visível para o cliente" merecem aviso. O resto entra porque é da mesma
 * natureza (muda o que o card É), não porque alguém pediu campo a campo. */
const EDIT_FIELDS = [
  { key: "title", label: "título" },
  { key: "description", label: "descrição" },
  { key: "priority", label: "prioridade" },
  { key: "client_visible", label: "visibilidade para o cliente" },
  { key: "kind", label: "tipo" },
  { key: "subtype", label: "subtipo" },
  { key: "client_id", label: "cliente" },
  { key: "assignee", label: "responsável" },
  { key: "plan_id", label: "vínculo" },
  { key: "progress_weight", label: "peso" },
  { key: "requires_review", label: "revisão obrigatória" },
  { key: "requires_approval", label: "aprovação obrigatória" },
  { key: "recurrence_cadence", label: "recorrência" },
  { key: "recurrence_weekdays", label: "dias da recorrência" },
  { key: "recurrence_day_of_month", label: "dia do mês da recorrência" },
] as const;

/** O `payload` NUNCA é comparado inteiro — só estas chaves, que são exatamente
 * as que a tela edita (o `payload_patch` de taskPatchSchema).
 *
 * Lista branca, e não negra, resolve dois problemas de uma vez e por
 * construção: `payload.comments` não está aqui, então acrescentar um
 * comentário é invisível para esta função (quem avisa comentário é a rota de
 * comentários, e avisar nos dois seria a mesma frase duas vezes); e todo o
 * bookkeeping que as automações escrevem — `recurrence_cycle`,
 * `trafego_report_at`, `pre_parada_status`, `sales_report_generated_at`… —
 * fica de fora sem ninguém precisar enumerá-lo. Uma lista negra teria que
 * caçar as 20+ chaves de taskPayloadSchema e vazaria na próxima que nascesse. */
const PAYLOAD_WATCHED = [
  { key: "formato", label: "formato" },
  { key: "plataforma", label: "plataforma" },
  { key: "hora", label: "horário" },
  { key: "statusLabel", label: "etiqueta" },
  { key: "statusTone", label: "cor da etiqueta" },
  { key: "barTone", label: "cor da barra" },
] as const;

export type AssignedRole = "responsavel" | "revisor" | "aprovador";

export type TaskChangeShape = {
  id: string;
  title: string;
  status: string;
  reviewer_id: string | null;
  approver_id: string | null;
  payload: Record<string, unknown> | null;
  assignee_profile_ids?: string[] | null;
  [field: string]: unknown;
};

export type NotifiableChange = {
  /** Um evento, no máximo, para o leque de participantes do card. */
  fanout: { type: NotificationType; message: string } | null;
  /** Vai SÓ para quem acabou de entrar no card — não passa pelo leque. */
  direct: { profileId: string; role: AssignedRole; message: string }[];
};

function changed(before: TaskChangeShape, after: TaskChangeShape, key: string): boolean {
  return JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
}

function changedLabels(
  before: TaskChangeShape,
  after: TaskChangeShape,
  fields: readonly { key: string; label: string }[],
): string[] {
  return fields.filter((f) => changed(before, after, f.key)).map((f) => f.label);
}

function changedPayloadLabels(before: TaskChangeShape, after: TaskChangeShape): string[] {
  const a = before.payload ?? {};
  const b = after.payload ?? {};
  return PAYLOAD_WATCHED.filter((f) => JSON.stringify(a[f.key] ?? null) !== JSON.stringify(b[f.key] ?? null)).map(
    (f) => f.label,
  );
}

/**
 * O que este salvamento merece anunciar.
 *
 * `fanout` e `direct` são separados porque os destinatários são conjuntos
 * diferentes: o leque do card já sabe que o card existe, enquanto "você virou
 * responsável" só interessa a quem acabou de entrar. Mudar o status E atribuir
 * alguém no mesmo salvamento são dois fatos para duas plateias.
 *
 * O `fanout` é no máximo UM evento: status ganha de data, que ganha de edição.
 * Avisar "mudou para Revisão" e "prazo alterado" pelo mesmo save encheria a
 * caixa com o mesmo acontecimento contado duas vezes.
 */
export function notifiableChange(before: TaskChangeShape, after: TaskChangeShape): NotifiableChange {
  const direct = directAssignments(before, after);

  if (changed(before, after, "status")) {
    return {
      fanout: { type: "task_status_changed", message: statusChangedMessage(after.title, after.status) },
      direct,
    };
  }

  const dateLabels = changedLabels(before, after, DATE_FIELDS);
  if (dateLabels.length) {
    const primary = DATE_FIELDS.find((f) => changed(before, after, f.key))!;
    return {
      fanout: {
        type: "task_due_changed",
        message: dueChangedMessage(after.title, dateLabels, (after[primary.key] as string | null) ?? null),
      },
      direct,
    };
  }

  const editLabels = [...changedLabels(before, after, EDIT_FIELDS), ...changedPayloadLabels(before, after)];
  if (editLabels.length) {
    return { fanout: { type: "task_updated", message: taskUpdatedMessage(after.title, editLabels) }, direct };
  }

  return { fanout: null, direct };
}

/** Quem ACABOU de entrar no card. Sair não é evento: "você não é mais
 * responsável" não é uma tarefa que alguém precise fazer. */
function directAssignments(before: TaskChangeShape, after: TaskChangeShape): NotifiableChange["direct"] {
  const out: NotifiableChange["direct"] = [];
  const previous = new Set(before.assignee_profile_ids ?? []);
  for (const id of after.assignee_profile_ids ?? []) {
    if (!previous.has(id)) out.push({ profileId: id, role: "responsavel", message: assignedMessage(after.title, "responsavel") });
  }

  if (after.approver_id && after.approver_id !== before.approver_id) {
    out.push({ profileId: after.approver_id, role: "aprovador", message: assignedMessage(after.title, "aprovador") });
  }

  // Revisor só quando o card NÃO está entrando em revisão: nesse caso o trigger
  // `notify_task_reviewer_assigned` já manda o aviso dedicado na mesma
  // transação, e mandar os dois é a mesma frase duas vezes.
  if (after.reviewer_id && after.reviewer_id !== before.reviewer_id && after.status !== "revisao") {
    out.push({ profileId: after.reviewer_id, role: "revisor", message: assignedMessage(after.title, "revisor") });
  }

  return out;
}

/** Exportado só para o teste conseguir afirmar que a lista de ignorados é a
 * que o comentário promete. */
export const NEVER_NOTIFIES = IGNORED_FIELDS;
