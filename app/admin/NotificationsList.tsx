"use client";

import { formatCommentTime } from "@/lib/comments";
import type { NotificationRecord, NotificationType } from "@/lib/notificationTypes";

// Shared body of the notifications inbox: the bell dropdown in AdminShell and
// the wider panel on the admin Home render the same rows, so they can't drift.
//
// Sem filtro de tipo aqui. Existia um, por `localStorage`, e ele era pior que
// não ter: a linha continuava sendo gravada, o sino continuava CONTANDO
// (AdminShell conta `notifications`, não o que esta lista mostra), e a
// preferência valia só naquele navegador. A regra agora é do servidor — o tipo
// desligado não vira linha nenhuma.

const TYPE_ICON: Record<NotificationType, string> = {
  task_review_assigned: "◉",
  task_due_soon: "◔",
  task_created: "✦",
  task_commented: "💬",
  task_updated: "✎",
  task_status_changed: "⇄",
};

export default function NotificationsList({
  notifications,
  emptyLabel = "Nenhuma notificação por aqui.",
  onOpenTask,
}: {
  notifications: NotificationRecord[];
  emptyLabel?: string;
  /** Quando informado, a linha de uma notificação com card vira clicável. */
  onOpenTask?: (taskId: string) => void;
}) {
  if (notifications.length === 0) return <p className="admin-notif-empty">{emptyLabel}</p>;

  return (
    <>
      {notifications.map((notif) => {
        const body = (
          <>
            <span className="admin-notif-ico" aria-hidden="true">
              {TYPE_ICON[notif.type] ?? "◉"}
            </span>
            <span className="admin-notif-body">
              <span className="admin-notif-text">{notif.message}</span>
              <span className="admin-notif-time">{formatCommentTime(notif.created_at)}</span>
            </span>
          </>
        );
        const className = `admin-notif-item${notif.read_at ? "" : " unread"}`;
        if (onOpenTask && notif.task_id) {
          return (
            <button
              type="button"
              className={`${className} clickable`}
              key={notif.id}
              onClick={() => onOpenTask(notif.task_id as string)}
            >
              {body}
            </button>
          );
        }
        return (
          <div className={className} key={notif.id} role="menuitem">
            {body}
          </div>
        );
      })}
    </>
  );
}
