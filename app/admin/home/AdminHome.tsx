"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminHomeSummary, HomeFocus } from "@/lib/supabase";
import { formatShortDate, relativeDue } from "../taskDates";
import { agencyToday } from "../recurringState";
import { STATUS_LABEL } from "../kanbanShared";
import { formatCommentTime } from "@/lib/comments";
import type { TaskRecord } from "@/lib/validation";
import CardModalLauncher from "../CardModalLauncher";
import { useNotificationsRealtime } from "@/lib/useNotificationsRealtime";
import type { NotificationRecord } from "@/lib/notificationTypes";
import { useCurrentAdminUser } from "../CurrentUserContext";
import NotificationsList from "../NotificationsList";
import NewTaskButton from "../NewTaskButton";
import WeekCalendar from "./WeekCalendar";

// A Home é um painel OPERACIONAL pessoal (dashboard-designer): quem abre é uma
// pessoa da equipe, todo dia, e a decisão que ela toma aqui é "o que eu resolvo
// primeiro". Daí a hierarquia:
//
//   1. uma frase que responde a pergunta ("você tem 5 atrasadas e 2 menções");
//   2. quatro KPIs PESSOAIS e acionáveis — cada um abre a tela que resolve, e o
//      de atraso traz a agência como comparação;
//   3. a lista curta do que resolver primeiro, ao lado das menções e rotinas;
//   4. a semana da agência e as notificações, como contexto.
//
// Nenhuma lista rola por dentro: cada uma mostra os primeiros e leva ao quadro
// já filtrado para o resto. Vermelho só onde há atraso de verdade.

const RESOLVE_LIMIT = 6;
const MENTIONS_LIMIT = 4;
const ROUTINES_LIMIT = 5;

const CADENCE_LABEL: Record<string, string> = { semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };

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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b e c" */
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

export default function AdminHome({ summary, focus, userName }: { summary: AdminHomeSummary; focus: HomeFocus; userName: string | null }) {
  const user = useCurrentAdminUser();
  const todayIso = agencyToday();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [weekView, setWeekView] = useState<"lista" | "calendario">("lista");
  // A Home só carrega o resumo do card. O modal precisa do TaskRecord inteiro,
  // então busca sob demanda no clique (GET /api/admin/tasks/[id]).
  const [openTask, setOpenTask] = useState<{ task: TaskRecord; clientName: string; clientSlug: string } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  const openCard = useCallback(async (item: { id: string; clientName: string; clientSlug: string }) => {
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
  const { counts } = focus;
  const needsAction = counts.atrasadas + counts.paradas;

  // A frase do topo responde a pergunta da Home antes de qualquer número.
  const pending = [
    counts.atrasadas ? plural(counts.atrasadas, "tarefa atrasada", "tarefas atrasadas") : "",
    counts.paradas ? plural(counts.paradas, "parada", "paradas") : "",
    focus.mentionsTotal ? plural(focus.mentionsTotal, "menção esperando resposta", "menções esperando resposta") : "",
  ].filter(Boolean);
  const headline = pending.length ? `Você tem ${joinPt(pending)}.` : "Nada atrasado, parado ou esperando resposta com você.";

  const kpis = [
    {
      key: "atrasadas",
      label: "Minhas atrasadas",
      value: counts.atrasadas,
      sub: `de ${summary.overdueTasks} na agência`,
      href: "/admin/operacao?situacao=atrasada",
      tone: counts.atrasadas ? "red" : "",
    },
    {
      key: "paradas",
      label: "Minhas paradas",
      value: counts.paradas,
      sub: counts.paradas ? "destravar primeiro" : "nenhuma travada",
      href: "/admin/operacao?situacao=parada",
      tone: counts.paradas ? "gold" : "",
    },
    {
      key: "mencoes",
      label: "Aguardando minha resposta",
      value: focus.mentionsTotal,
      sub: focus.mentionsTotal ? "menções sem resposta" : "nenhuma menção pendente",
      href: "#home-mentions",
      tone: focus.mentionsTotal ? "teal" : "",
    },
    {
      key: "semana",
      label: "Minhas entregas na semana",
      value: counts.week,
      sub: counts.today ? `${plural(counts.today, "vence", "vencem")} hoje` : "próximos 7 dias",
      href: "/admin/operacao",
      tone: "",
    },
  ];

  const resolveRows = focus.attention.slice(0, RESOLVE_LIMIT);
  const hiddenResolve = needsAction - resolveRows.length;

  return (
    <section className="admin-page home-page">
      <header className="admin-head">
        <div>
          <h1 className="serif admin-title">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="admin-sub">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · <b className="home-headline">{headline}</b>
          </p>
        </div>
        <div className="admin-head-actions">
          <NewTaskButton />
        </div>
      </header>

      <div className="home-kpis home-kpis-4">
        {kpis.map((k) => (
          <Link className={`home-kpi${k.tone ? ` is-${k.tone}` : ""}`} href={k.href} key={k.key}>
            <span className="home-kpi-label">{k.label}</span>
            <strong className={`home-kpi-value${k.tone ? ` t-${k.tone}` : ""}`}>{k.value}</strong>
            <span className="home-kpi-sub">{k.sub}</span>
          </Link>
        ))}
      </div>

      <p className="home-agency">
        Agência hoje: <b>{summary.overdueTasks}</b> atrasadas · <b>{summary.weekAheadCount}</b> entregas na semana ·
        planos em <b>{summary.actionPlansAvgProgress}%</b> ({summary.actionPlansInProgress} em andamento)
        {summary.reviewQueueCount + summary.approvalQueueCount > 0
          ? <> · <Link href="/admin/revisoes">{summary.reviewQueueCount + summary.approvalQueueCount} em revisão/aprovação</Link></>
          : null}
      </p>

      <div className="home-main">
        <div className="admin-card home-resolve">
          <div className="home-card-head">
            <p className="admin-card-title">
              {needsAction ? `${plural(needsAction, "tarefa sua pede", "tarefas suas pedem")} ação` : "Nenhuma tarefa sua atrasada ou parada"}
            </p>
            {needsAction ? <Link className="admin-btn ghost" href="/admin/operacao?situacao=atrasada">Ver no quadro →</Link> : null}
          </div>
          {resolveRows.length ? (
            <ul className="home-focus-list">
              {resolveRows.map((t) => {
                const rel = relativeDue(t.dueDate, todayIso);
                return (
                  <li key={t.id}>
                    <button type="button" className={`home-focus-row is-${t.situation}`} onClick={() => void openCard(t)} disabled={openingId === t.id}>
                      <span className={`kb-situacao s-${t.situation}`}>{t.situation === "parada" ? "Parada" : "Atrasada"}</span>
                      <span className="home-focus-main">
                        <strong>{t.title}</strong>
                        <em>
                          {t.clientName} · {STATUS_LABEL[t.status]}
                          {t.dueDate ? ` · ${t.situation === "atrasada" && rel ? `venceu ${rel}` : formatShortDate(t.dueDate)}` : ""}
                        </em>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="admin-hint">Tudo em dia com você. As tarefas atrasadas ou paradas em que você é responsável aparecem aqui.</p>
          )}
          {hiddenResolve > 0 ? (
            <Link className="home-card-more" href="/admin/operacao?situacao=atrasada">+ {plural(hiddenResolve, "outra", "outras")} no quadro →</Link>
          ) : null}
        </div>

        <div className="home-side">
          <div className="admin-card" id="home-mentions">
            <div className="home-card-head">
              <p className="admin-card-title">Aguardando sua resposta</p>
              {focus.mentionsTotal ? <span className="admin-pill on">{focus.mentionsTotal}</span> : null}
            </div>
            {focus.mentions.length ? (
              <ul className="home-focus-list">
                {focus.mentions.slice(0, MENTIONS_LIMIT).map((m) => (
                  <li key={`${m.taskId}-${m.at}`}>
                    <button type="button" className="home-focus-row" onClick={() => void openCard({ id: m.taskId, clientName: m.clientName, clientSlug: m.clientSlug })} disabled={openingId === m.taskId}>
                      <span className="home-focus-at" aria-hidden>@</span>
                      <span className="home-focus-main">
                        <strong>{m.author} em “{m.title}”</strong>
                        <em className="home-focus-quote">{m.text}</em>
                        <em>{formatCommentTime(m.at)}</em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-hint">Ninguém esperando você. Quando alguém escrever @{firstName || "seu nome"} num card, aparece aqui até você responder.</p>
            )}
            {focus.mentionsTotal > MENTIONS_LIMIT ? (
              <p className="home-card-more is-static">+ {plural(focus.mentionsTotal - MENTIONS_LIMIT, "outra menção", "outras menções")}</p>
            ) : null}
          </div>

          {focus.routines.length ? (
            <div className="admin-card">
              <div className="home-card-head">
                <p className="admin-card-title">Suas rotinas da semana</p>
                <Link className="admin-btn ghost" href="/admin/operacao">Rotinas →</Link>
              </div>
              <ul className="home-focus-list">
                {focus.routines.slice(0, ROUTINES_LIMIT).map((r) => {
                  const rel = relativeDue(r.nextDue, todayIso);
                  return (
                    <li key={r.id}>
                      <button type="button" className={`home-focus-row ${r.overdue ? "is-atrasada" : ""}`} onClick={() => void openCard(r)} disabled={openingId === r.id}>
                        <span className={`kb-situacao ${r.overdue ? "s-atrasada" : "s-no_prazo"}`}>{r.overdue ? "Atrasada" : `↻ ${CADENCE_LABEL[r.cadence] ?? r.cadence}`}</span>
                        <span className="home-focus-main">
                          <strong>{r.title}</strong>
                          <em>{r.clientName} · {formatShortDate(r.nextDue)}{rel ? ` · ${rel}` : ""}</em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="home-cols">
        {/* O calendário precisa da largura toda; a lista cabe numa coluna, mas
            só divide a linha quando o painel de notificações existe — sem ele,
            a metade direita ficava vazia. */}
        <div className={`admin-card${weekView === "calendario" || unread === 0 ? " home-card-wide" : ""}`}>
          <div className="home-card-head">
            <p className="admin-card-title">Esta semana na agência · {summary.weekAheadCount}</p>
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

      <p className="home-updated">Atualizado às {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · recarregue a página para atualizar os números.</p>

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
