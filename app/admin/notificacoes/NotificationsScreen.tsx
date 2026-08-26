"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_TYPE_LABEL, type NotificationRecord, type NotificationType } from "@/lib/notificationTypes";
import type { TaskRecord } from "@/lib/validation";
import { useNotificationsRealtime } from "@/lib/useNotificationsRealtime";
import { useCurrentAdminUser } from "../CurrentUserContext";
import CardModalLauncher from "../CardModalLauncher";
import NotificationsList from "../NotificationsList";

// Caixa de entrada inteira. O sino no AdminShell e o painel da Home mostram os
// primeiros itens; aqui é a lista completa, com filtro por tipo e "marcar
// todas como lidas". Clicar numa notificação de card abre o card.

type Filter = "todas" | "nao_lidas" | NotificationType;

export default function NotificationsScreen({ initial }: { initial: NotificationRecord[] }) {
  const user = useCurrentAdminUser();
  const router = useRouter();
  const [notifications, setNotifications] = useState(initial);
  const [filter, setFilter] = useState<Filter>("nao_lidas");
  const [openTask, setOpenTask] = useState<TaskRecord | null>(null);
  const [busy, setBusy] = useState(false);
  // client_id -> cliente, para que o card aberto daqui chegue ao modal com o
  // slug certo (o modal usa o slug para buscar revisores e flow-flags; sem ele
  // o card abre mudo).
  const [clientsById, setClientsById] = useState<Record<string, { slug: string; name: string }>>({});

  const refetch = useCallback(() => {
    fetch("/api/admin/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notifications: NotificationRecord[] } | null) => {
        if (data) setNotifications(data.notifications);
      })
      .catch(() => {});
  }, []);

  useEffect(() => setNotifications(initial), [initial]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/clients")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { clients?: { id: string; slug: string; name: string }[] } | null) => {
        if (cancelled || !data?.clients) return;
        setClientsById(Object.fromEntries(data.clients.map((c) => [c.id, { slug: c.slug, name: c.name }])));
      })
      .catch(() => { /* o card ainda abre, só sem as opções que dependem do slug */ });
    return () => { cancelled = true; };
  }, []);
  useNotificationsRealtime(user.userId, refetch);

  const unread = notifications.filter((n) => !n.read_at);

  // Só oferece os tipos que a caixa realmente contém — um filtro que sempre
  // devolve vazio é ruído.
  const presentTypes = useMemo(
    () => Array.from(new Set(notifications.map((n) => n.type))),
    [notifications],
  );

  const shown = useMemo(() => {
    if (filter === "todas") return notifications;
    if (filter === "nao_lidas") return unread;
    return notifications.filter((n) => n.type === filter);
  }, [filter, notifications, unread]);

  async function markAllRead() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setNotifications((rows) => rows.map((r) => (r.read_at ? r : { ...r, read_at: now })));
      }
    } finally {
      setBusy(false);
    }
  }

  async function openCard(taskId: string) {
    const res = await fetch(`/api/admin/tasks/${taskId}`);
    if (!res.ok) return;
    setOpenTask((await res.json()) as TaskRecord);
  }

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Notificações</h1>
          <p className="admin-sub">
            {unread.length > 0 ? `${unread.length} não lidas` : "Tudo lido por aqui."}
          </p>
        </div>
        <div className="admin-head-actions">
          <button type="button" className="admin-btn" onClick={markAllRead} disabled={busy || unread.length === 0}>
            Marcar todas como lidas
          </button>
        </div>
      </header>

      <nav className="clients-section-tabs" aria-label="Filtrar notificações">
        <button type="button" className={filter === "nao_lidas" ? "on" : ""} onClick={() => setFilter("nao_lidas")}>
          Não lidas <span>{unread.length}</span>
        </button>
        <button type="button" className={filter === "todas" ? "on" : ""} onClick={() => setFilter("todas")}>
          Todas <span>{notifications.length}</span>
        </button>
        {presentTypes.map((type) => (
          <button type="button" key={type} className={filter === type ? "on" : ""} onClick={() => setFilter(type)}>
            {NOTIFICATION_TYPE_LABEL[type]}
          </button>
        ))}
      </nav>

      <div className="admin-card notif-screen">
        <NotificationsList
          notifications={shown}
          emptyLabel={filter === "nao_lidas" ? "Nenhuma notificação pendente." : "Nada por aqui."}
          onOpenTask={openCard}
        />
      </div>

      {openTask ? (
        <CardModalLauncher
          task={openTask}
          clientName={(openTask.client_id && clientsById[openTask.client_id]?.name) || "Sem cliente"}
          clientSlug={(openTask.client_id && clientsById[openTask.client_id]?.slug) || ""}
          onClose={() => setOpenTask(null)}
          onSaved={() => { setOpenTask(null); router.refresh(); }}
          onDeleted={() => { setOpenTask(null); router.refresh(); }}
        />
      ) : null}
    </section>
  );
}
