import { createClient } from "./supabase/server";
import { HttpError } from "./validation";
import { type NotificationRecord, type NotificationType } from "./notificationTypes";
// Usado aqui dentro (upsertDueSoonNotifications), não só re-exportado.
import { dueSoonMessage } from "./notifiableChange";

// Re-exportados para não quebrar quem já importa daqui; a definição vive em
// ./notificationTypes porque este módulo é server-only.
export { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABEL } from "./notificationTypes";
export type { NotificationRecord, NotificationType } from "./notificationTypes";

// Notifications: lightweight per-account inbox (supabase/migrations/20260819000001_notifications.sql).
// Two producers land in the same table:
//   - task_review_assigned: a DB trigger on `tasks` (see migration).
//   - task_due_soon: computado de forma preguiçosa —
//     upsertDueSoonNotifications() é chamado por GET /api/admin/notifications
//     antes da leitura. Consequência assumida: quem não abre a tela não recebe
//     o aviso, e é por isso que ele continua sendo um item aberto (R5.3).
//     Isto NÃO é mais por falta de agendador: desde 2026-09-01 existe cron real
//     em produção (pg_cron + segredo no Vault, job `automations-run-daily`,
//     migração 20260901010000) e o caminho para tornar o aviso proativo é
//     reusar esse padrão — não construir um do zero.
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

// Os construtores de mensagem moraram aqui até 2026-09-06 e foram para
// ./notifiableChange junto com a decisão de O QUE notificar — texto e critério
// são a mesma pergunta, e este módulo é server-only (importa next/headers pelo
// ./supabase/server), o que impedia testá-los sem carregar meio Next. Seguem
// re-exportados para não mexer em quem já importa daqui.
export {
  dueSoonMessage,
  statusChangedMessage,
  taskCreatedMessage,
  taskUpdatedMessage,
  taskCommentedMessage,
  dueChangedMessage,
  assignedMessage,
} from "./notifiableChange";

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

/**
 * Avisa pessoas NOMEADAS, e não o leque do card.
 *
 * O caso é "você virou responsável": só interessa a quem ainda não estava no
 * card, e por definição essa pessoa não está no leque que
 * `notify_task_participants` deriva. Aquela função não aceitar destinatário é
 * garantia dela — é o que impede um chamador de usá-la para escrever na caixa
 * de qualquer um —, então o endereçado tem porta própria.
 *
 * Best-effort, igual ao leque: uma notificação que falha não pode derrubar o
 * salvamento que o usuário acabou de fazer.
 */
export async function notifyProfiles(
  profileIds: string[],
  taskId: string,
  type: NotificationType,
  message: string,
): Promise<void> {
  if (!profileIds.length) return;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("notify_profiles", {
      p_profile_ids: profileIds,
      p_task_id: taskId,
      p_type: type,
      p_message: message,
    });
    if (error) console.error("Notifications direct error", { code: error.code, message: error.message?.slice(0, 240) });
  } catch (error) {
    console.error("Notifications direct threw", error);
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
