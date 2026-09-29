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
import ClientPulse from "./ClientPulse";
import AgencyMedia from "./AgencyMedia";
import FeedShortcut from "./FeedShortcut";
import { useClientInsights } from "./useInsights";
import { dueWording } from "../operacao/operationItems";
import { operacaoHref } from "../operacao/operacaoLinks";

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

const RESOLVE_LIMIT = 8;
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
  const insights = useClientInsights();

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

  // A Home responde UMA pergunta: "o que eu preciso fazer?" (29/09). Cada
  // resposta é um botão que abre a Operação já filtrada no recorte que
  // resolve — a pessoa não precisa montar o filtro. Pessoal primeiro, depois o
  // que é da agência; zero aparece apagado, para dizer "isso está em dia".
  const me = firstName;
  const actions: { key: string; value: number; label: string; sub: string; href: string; filter: string; tone: "late" | "warn" | "ok" | "info" }[] = [
    { key: "atrasadas", value: counts.atrasadas, label: counts.atrasadas === 1 ? "Resolver 1 atrasada" : `Resolver ${counts.atrasadas} atrasadas`, sub: "na Operação, dentro dos planos e entregas de que fazem parte", href: operacaoHref({ responsavel: me, situacao: "atrasada", agrupar: "cliente" }), filter: `${me || "Você"} · Atrasada · por cliente`, tone: "late" },
    { key: "paradas", value: counts.paradas, label: counts.paradas === 1 ? "Destravar 1 parada" : `Destravar ${counts.paradas} paradas`, sub: "esperando algo para andar", href: operacaoHref({ responsavel: me, situacao: "parada" }), filter: `${me || "Você"} · Parada`, tone: "warn" },
    { key: "semana", value: counts.week, label: counts.week === 1 ? "Entregar 1 esta semana" : `Entregar ${counts.week} esta semana`, sub: counts.today ? `${plural(counts.today, "vence", "vencem")} hoje` : "próximos 7 dias", href: operacaoHref({ responsavel: me, agrupar: "prazo" }), filter: `${me || "Você"} · por prazo`, tone: "info" },
    { key: "mencoes", value: focus.mentionsTotal, label: focus.mentionsTotal === 1 ? "Responder 1 menção" : `Responder ${focus.mentionsTotal} menções`, sub: "alguém escreveu @" + (me || "você"), href: "#home-mentions", filter: "logo abaixo", tone: "info" },
    { key: "revisao", value: summary.reviewQueueCount, label: `Revisar ${summary.reviewQueueCount}`, sub: "cards da agência em Revisão", href: operacaoHref({ status: ["revisao"], agrupar: "cliente" }), filter: "Status: Revisão · por cliente", tone: "info" },
    { key: "aprovacao", value: summary.approvalQueueCount, label: `Acompanhar ${summary.approvalQueueCount} com o cliente`, sub: "esperando aprovação do cliente", href: operacaoHref({ status: ["aprovacao"], agrupar: "cliente" }), filter: "Status: Aprovação · por cliente", tone: "info" },
    { key: "rotinas", value: focus.routines.length, label: focus.routines.length === 1 ? "Cuidar de 1 rotina" : `Cuidar de ${focus.routines.length} rotinas`, sub: "suas rotinas desta semana", href: operacaoHref({ responsavel: me, tipo: ["rotina"] }), filter: `${me || "Você"} · Rotina`, tone: "ok" },
    { key: "agencia", value: summary.overdueTasks, label: `${summary.overdueTasks} atrasadas na agência`, sub: "de toda a equipe, por responsável", href: operacaoHref({ situacao: "atrasada", agrupar: "responsavel" }), filter: "Atrasada · por responsável", tone: "late" },
  ];

  const resolveRows = focus.attention.slice(0, RESOLVE_LIMIT);
  const hiddenResolve = needsAction - resolveRows.length;

  return (
    <section className="admin-page kb-wide home-page home-v2">
      <header className="home-hero-v2">
        <div>
          <p className="home-eyebrow-v2">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · {greeting()}{firstName ? `, ${firstName}` : ""}</p>
          <h1 className="serif home-question">O que eu preciso fazer hoje?</h1>
          <p className="home-answer">{headline}</p>
        </div>
        <div className="admin-head-actions">
          <NewTaskButton />
        </div>
      </header>

      <nav className="home-actions" aria-label="O que fazer agora">
        {actions.map((action) => (
          <Link key={action.key} href={action.href} className={`home-action tone-${action.tone}${action.value ? "" : " is-zero"}`}>
            <span className="home-action-top">
              <strong className="home-action-value">{action.value}</strong>
              <span className="home-action-go" aria-hidden>→</span>
            </span>
            <span className="home-action-label">{action.value ? action.label : action.label.replace(/\d+ /, "0 ")}</span>
            <span className="home-action-sub">{action.sub}</span>
            <span className="home-action-filter">{action.href.startsWith("#") ? action.filter : `Abre a Operação · ${action.filter}`}</span>
          </Link>
        ))}
      </nav>

      <AgencyMedia insights={insights} />

      <div className="home-board">
        <div className="admin-card home-resolve">
          <div className="home-card-head">
            <p className="admin-card-title">
              {needsAction ? `Resolver primeiro · ${plural(needsAction, "tarefa sua", "tarefas suas")}` : "Nada seu atrasado ou parado"}
            </p>
            {needsAction ? <Link className="admin-btn ghost" href={operacaoHref({ responsavel: me, situacao: "atrasada", agrupar: "cliente" })}>Ver todas →</Link> : null}
          </div>
          {resolveRows.length ? (
            <ul className="home-focus-list">
              {resolveRows.map((t) => (
                <li key={t.id}>
                  <button type="button" className={`home-focus-row is-${t.situation}`} onClick={() => void openCard(t)} disabled={openingId === t.id}>
                    <span className={`op-dot tone-${t.situation === "parada" ? "warn" : "late"}`} aria-hidden />
                    <span className="home-focus-main">
                      <strong>{t.title}</strong>
                      <em>
                        {t.clientName} · {t.situation === "parada" ? "Parada" : STATUS_LABEL[t.status]}
                        {t.dueDate ? ` · ${t.situation === "atrasada" ? dueWording(t.dueDate, todayIso).text : formatShortDate(t.dueDate)}` : ""}
                      </em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-hint">Tudo em dia com você. As tarefas atrasadas ou paradas em que você é responsável aparecem aqui.</p>
          )}
          {hiddenResolve > 0 ? (
            <Link className="home-card-more" href={operacaoHref({ responsavel: me, situacao: "atrasada" })}>+ {plural(hiddenResolve, "outra", "outras")} na Operação →</Link>
          ) : null}
        </div>

        <div className="home-stack">
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
                <Link className="admin-btn ghost" href={operacaoHref({ responsavel: me, tipo: ["rotina"] })}>Rotinas →</Link>
              </div>
              <ul className="home-focus-list">
                {focus.routines.slice(0, ROUTINES_LIMIT).map((r) => {
                  const rel = relativeDue(r.nextDue, todayIso);
                  return (
                    <li key={r.id}>
                      <button type="button" className={`home-focus-row ${r.overdue ? "is-atrasada" : ""}`} onClick={() => void openCard(r)} disabled={openingId === r.id}>
                        <span className={`op-dot tone-${r.overdue ? "late" : "ok"}`} aria-hidden />
                        <span className="home-focus-main">
                          <strong>{r.title}</strong>
                          <em>{r.clientName} · ↻ {(CADENCE_LABEL[r.cadence] ?? r.cadence).toLowerCase()} · {r.overdue ? dueWording(r.nextDue, todayIso).text : `próxima ${formatShortDate(r.nextDue)}${rel ? ` (${rel})` : ""}`}</em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="home-stack">
          <FeedShortcut />
          <div className="admin-card">
            <div className="home-card-head">
              <p className="admin-card-title">Esta semana na agência · {summary.weekAheadCount}</p>
              <button
                type="button"
                className="admin-btn ghost"
                aria-pressed={weekView === "calendario"}
                onClick={() => setWeekView((v) => (v === "lista" ? "calendario" : "lista"))}
              >
                {weekView === "lista" ? "Calendário" : "Lista"}
              </button>
            </div>
            {weekView === "calendario" ? (
              <WeekCalendar items={summary.weekAhead} />
            ) : summary.weekAhead.length === 0 ? (
              <p className="admin-hint">Nenhum prazo nos próximos sete dias.</p>
            ) : (
              <ul className="home-list">
                {summary.weekAhead.slice(0, 8).map((t) => {
                  const d = shortDate(t.dueDate);
                  return (
                    <li key={t.id}>
                      <button type="button" className="home-list-open" onClick={() => void openCard(t)} disabled={openingId === t.id} aria-label={`Abrir card ${t.title}`}>
                        <span className="home-date"><strong>{d.day}</strong><em>{d.month}</em></span>
                        <span className="home-list-main"><strong>{t.title}</strong><span className="admin-hint">{t.clientName}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {summary.weekAheadCount > 8 ? <Link className="home-card-more" href={operacaoHref({ agrupar: "prazo" })}>Ver a semana inteira na Operação →</Link> : null}
          </div>
          {unread > 0 ? (
            <div className="admin-card">
              <div className="home-card-head">
                <p className="admin-card-title">Notificações</p>
                <span className="admin-pill on">{unread} novas</span>
                <Link className="admin-btn ghost" href="/admin/notificacoes">Todas →</Link>
              </div>
              <div className="home-notifs">
                <NotificationsList notifications={notifications.filter((n) => !n.read_at).slice(0, 5)} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* O pulso é contexto da agência, não tarefa sua: fecha a página. */}
      <ClientPulse today={todayIso} insights={insights} onOpen={(item) => void openCard(item)} />

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
