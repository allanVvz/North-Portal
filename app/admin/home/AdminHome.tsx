"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminHomeSummary } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";
import CardModalLauncher from "../CardModalLauncher";
import { useNotificationsRealtime } from "@/lib/useNotificationsRealtime";
import type { NotificationRecord } from "@/lib/notificationTypes";
import { useCurrentAdminUser } from "../CurrentUserContext";
import NotificationsList from "../NotificationsList";
import NewTaskLauncher from "./NewTaskLauncher";
import WeekCalendar from "./WeekCalendar";

// Admin landing page. Every number here links to the screen that resolves it —
// a KPI you can't act on is just decoration.

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function shortDate(iso: string): { day: string; month: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase(),
  };
}

export default function AdminHome({ summary, userName }: { summary: AdminHomeSummary; userName: string | null }) {
  const user = useCurrentAdminUser();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [weekView, setWeekView] = useState<"lista" | "calendario">("lista");
  // A Home só carrega o resumo do card (id/título/prazo). O modal precisa do
  // TaskRecord inteiro, então busca sob demanda no clique — mesmo caminho que
  // Plano de Ação usa (GET /api/admin/tasks/[id]).
  const [openTask, setOpenTask] = useState<{ task: TaskRecord; clientName: string; clientSlug: string } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  const openCard = useCallback(async (item: AdminHomeSummary["weekAhead"][number]) => {
    setOpeningId(item.id);
    try {
      const res = await fetch(`/api/admin/tasks/${item.id}`);
      if (!res.ok) return;
      const task = (await res.json()) as TaskRecord;
      setOpenTask({ task, clientName: item.clientName, clientSlug: item.clientSlug });
    } catch {
      // rede caiu — o clique simplesmente não abre nada, sem quebrar a Home
    } finally {
      setOpeningId(null);
    }
  }, []);

  const refetch = useCallback(() => {
    fetch("/api/admin/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notifications: NotificationRecord[] } | null) => {
        if (data) setNotifications(data.notifications);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useNotificationsRealtime(user.userId, refetch);

  const unread = notifications.filter((n) => !n.read_at).length;
  const firstName = (userName ?? "").split(" ")[0];

  // Só KPIs acionáveis: "clientes ativos" era um número que nunca muda de dia
  // para dia, e revisão/aprovação já têm tela própria no menu.
  const kpis = [
    {
      label: "Tarefas desta semana",
      value: String(summary.weekAheadCount),
      href: "/admin/operacao",
      tone: "",
      sub: "não realizadas",
    },
    { label: "Tarefas atrasadas", value: String(summary.overdueTasks), href: "/admin/operacao", tone: summary.overdueTasks > 0 ? "red" : "" },
    {
      label: "Progresso dos planos",
      value: `${summary.actionPlansAvgProgress}%`,
      href: "/admin/operacao",
      tone: "",
      sub: `${summary.actionPlansInProgress} em andamento`,
    },
  ];

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1 className="serif admin-title">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="admin-sub">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            {summary.reviewQueueCount + summary.approvalQueueCount > 0
              ? ` · ${summary.reviewQueueCount + summary.approvalQueueCount} cards esperam você`
              : " · nada pendente por aqui"}
          </p>
        </div>
        <div className="admin-head-actions">
          <NewTaskLauncher />
        </div>
      </header>

      <div className="home-kpis">
        {kpis.map((k) => (
          <Link className="home-kpi" href={k.href} key={k.label}>
            <span className="home-kpi-label">{k.label}</span>
            <strong className={`home-kpi-value${k.tone ? ` t-${k.tone}` : ""}`}>{k.value}</strong>
            {k.sub ? <span className="home-kpi-sub">{k.sub}</span> : null}
          </Link>
        ))}
      </div>

      <div className="home-cols">
        {/* The week grid needs the full content width; the list fits a column. */}
        <div className={`admin-card${weekView === "calendario" ? " home-card-wide" : ""}`}>
          <div className="home-card-head">
            <p className="admin-card-title">Esta semana</p>
            <button
              type="button"
              className="admin-btn ghost"
              aria-pressed={weekView === "calendario"}
              onClick={() => setWeekView((v) => (v === "lista" ? "calendario" : "lista"))}
            >
              {weekView === "lista" ? "Ver calendário" : "Ver lista"}
            </button>
          </div>
          {weekView === "calendario" ? (
            <WeekCalendar items={summary.weekAhead} />
          ) : summary.weekAhead.length === 0 ? (
            <p className="admin-hint">Nenhum prazo nos próximos sete dias.</p>
          ) : (
            <ul className="home-list">
              {summary.weekAhead.slice(0, 6).map((t) => {
                const d = shortDate(t.dueDate);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="home-list-open"
                      onClick={() => void openCard(t)}
                      disabled={openingId === t.id}
                      aria-label={`Abrir card ${t.title}`}
                    >
                      <span className="home-date">
                        <strong>{d.day}</strong>
                        <em>{d.month}</em>
                      </span>
                      <span className="home-list-main">
                        <strong>{t.title}</strong>
                        <span className="admin-hint">{t.clientName}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* O painel não existe quando não há nada pendente — um card fixo
            dizendo "nenhuma notificação" só ocupava a coluna. */}
        {unread > 0 ? (
          <div className="admin-card">
            <div className="home-card-head">
              <p className="admin-card-title">Notificações</p>
              <span className="admin-pill on">{unread} novas</span>
              <Link className="admin-btn ghost" href="/admin/notificacoes">Ver todas →</Link>
            </div>
            <div className="home-notifs">
              <NotificationsList notifications={notifications.filter((n) => !n.read_at).slice(0, 8)} />
            </div>
          </div>
        ) : null}

      </div>

      {openTask ? (
        <CardModalLauncher
          task={openTask.task}
          clientName={openTask.clientName}
          clientSlug={openTask.clientSlug}
          onClose={() => setOpenTask(null)}
          onSaved={() => { setOpenTask(null); router.refresh(); }}
          onDeleted={() => { setOpenTask(null); router.refresh(); }}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}
