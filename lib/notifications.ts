import { createClient } from "./supabase/server";
import { HttpError } from "./validation";
import { type NotificationRecord, type NotificationType } from "./notificationTypes";

// Re-exportados para não quebrar quem já importa daqui; a definição vive em
// ./notificationTypes porque este módulo é server-only.
export { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABEL } from "./notificationTypes";
export type { NotificationRecord, NotificationType } from "./notificationTypes";

// Notifications: lightweight per-account inbox (supabase/migrations/20260819000001_notifications.sql).
// Two producers land in the same table:
//   - task_review_assigned: a DB trigger on `tasks` (see migration).
//   - task_due_soon: no cron/scheduled-job mechanism exists in this repo, so
//     it's computed lazily — upsertDueSoonNotifications() is called by
//     GET /api/admin/notifications before reading. Smallest real slice; a
//     real scheduler can replace the lazy computation later without
//     changing this module's shape or the table.
// The pure date-window logic below (isDueSoon) is kept separate from the
// Supabase calls so it's directly unit-testable (see lib/notifications.test.ts).

const NOTIFICATION_COLUMNS = "id,profile_id,task_id,type,message,read_at,created_at";

function fail(action: string, error: { message?: string; code?: string } | null): never {
  console.error(`Notifications ${action} error`, { code: error?.code, message: error?.message?.slice(0, 240) });
  throw new HttpError(503, "Nao foi possivel acessar as notificacoes.");
}

// ---- pure helpers (unit-tested) -----------------------------------------

// tasks.due_date has no time component, so "approaching" is compared in
// whole days rather than hours. windowDays=2 covers the requested ~24-48h
// window: due today (0), tomorrow (1), or the day after (2).
export const DUE_SOON_WINDOW_DAYS = 2;

/** True when `dueDate` (YYYY-MM-DD) falls within [today, today+windowDays],
 *  i.e. it's approaching but not already overdue. */
export function isDueSoon(dueDate: string | null, today: Date, windowDays: number = DUE_SOON_WINDOW_DAYS): boolean {
  if (!dueDate) return false;
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return false;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffDays = Math.round((due - start) / 86400000);
  return diffDays >= 0 && diffDays <= windowDays;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function formatDateBR(dueDate: string): string {
  const m = DATE_ONLY_RE.exec(dueDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dueDate;
}

export function dueSoonMessage(title: string, dueDate: string): string {
  return `Prazo próximo: "${title}" vence em ${formatDateBR(dueDate)}.`;
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

export function statusChangedMessage(title: string, status: string): string {
  return `"${title}" mudou para ${STATUS_LABEL[status] ?? status}.`;
}

export function taskUpdatedMessage(title: string): string {
  return `"${title}" foi editado.`;
}

export function taskCommentedMessage(title: string, author: string): string {
  return `${author} comentou em "${title}".`;
}

// ---- data access ----------------------------------------------------------

/** Current user's own inbox, newest first — unread and recent read together
 *  (callers/UI can split on `read_at`). */
export async function listNotifications(profileId: string, limit = 50): Promise<NotificationRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("list", error);
  return (data ?? []) as NotificationRecord[];
}

type AssignedTaskRow = { id: string; title: string; due_date: string | null; status: string };

/** Lazily materializes task_due_soon rows for `profileId`'s own assigned,
 *  not-yet-done tasks whose due_date is inside the approaching window.
 *  Upserts on (profile_id, task_id, type) — see migration — so repeat calls
 *  (every GET) refresh the same row's message instead of duplicating it or
 *  reviving one the user already marked read. */
export async function upsertDueSoonNotifications(profileId: string, today: Date = new Date()): Promise<void> {
  const supabase = await createClient();

  const { data: links, error: linksError } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("profile_id", profileId);
  if (linksError) fail("due-soon lookup", linksError);
  const taskIds = (links ?? []).map((r) => r.task_id as string);
  if (!taskIds.length) return;

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id,title,due_date,status")
    .in("id", taskIds)
    // Card entregue não recebe cobrança de prazo. Era `concluido` — o estágio
    // que deixou de existir —, o que significava que um card já concluído
    // continuava recebendo "prazo próximo".
    .neq("status", "aprovado")
    .not("due_date", "is", null);
  if (tasksError) fail("due-soon lookup", tasksError);

  const due = ((tasks ?? []) as AssignedTaskRow[]).filter((t) => isDueSoon(t.due_date, today));
  if (!due.length) return;

  const rows = due.map((t) => ({
    profile_id: profileId,
    task_id: t.id,
    type: "task_due_soon" as const,
    message: dueSoonMessage(t.title, t.due_date as string),
  }));
  const { error: upsertError } = await supabase
    .from("notifications")
    .upsert(rows, { onConflict: "profile_id,task_id,type" });
  if (upsertError) fail("due-soon upsert", upsertError);
}

/**
 * Avisa todo mundo ligado ao card — criador, executores, revisor e aprovador —
 * menos quem fez a ação. A escolha dos destinatários acontece dentro da função
 * SECURITY DEFINER no banco, a partir do próprio card: daqui não há como
 * endereçar alguém que não participa dele.
 *
 * Best-effort de propósito: uma notificação que falha não pode derrubar o
 * comentário ou a edição que o usuário acabou de salvar.
 */
export async function notifyTaskParticipants(
  taskId: string,
  type: NotificationType,
  message: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("notify_task_participants", {
      p_task_id: taskId,
      p_type: type,
      p_message: message,
    });
    if (error) console.error("Notifications fan-out error", { code: error.code, message: error.message?.slice(0, 240) });
  } catch (error) {
    console.error("Notifications fan-out threw", error);
  }
}

/** Marks either specific notification ids, or the caller's whole unread
 *  inbox (`"all"`), read. Always scoped to `profileId` — RLS enforces this
 *  too, but the .eq() keeps a mistaken cross-account id list a no-op instead
 *  of a 42501. */
export async function markNotificationsRead(profileId: string, ids: string[] | "all"): Promise<void> {
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null);
  if (ids !== "all") query = query.in("id", ids);
  const { error } = await query;
  if (error) fail("mark-read", error);
}
