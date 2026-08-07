"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecurringTask } from "@/lib/supabase";
import ClientsTable, { type ClientRow } from "./ClientsTable";
import HScrollRail from "./HScrollRail";
import RecurringSearchBar from "./RecurringSearchBar";
import { recurringMatchesFilters, recurringSearchText, type RecurringActiveFilter } from "./recurringTaskFilters";
import CardModalLauncher from "./CardModalLauncher";
import TaskModal from "./TaskModal";
import { PRIORITY_LABEL } from "./kanbanShared";
import { RECURRING_STATE_LABEL, RECURRING_STATE_TONE, recurringState, todayInTimezone, type RecurringState } from "./recurringState";
import { recurringOccurrences } from "./recurringOccurrences";
import { RECURRING_GROUP_BY_LABEL, compareByUrgency, groupRecurring, type RecurringGroupBy } from "./recurringGrouping";
import { calendarMonthCells, calendarMonthTitle, isoCalendarDate } from "./calendarUtils";
import TaskKindIcon from "./TaskKindIcon";
import { recurrenceCycleOf, recurrenceRevisionOf } from "@/lib/recurrenceState";
import type { TaskRecord } from "@/lib/validation";

type Section = "recorrencias" | "cadastro";
type RecurrenceView = "colunas" | "lista" | "calendario";

const CADENCE_LABEL: Record<RecurringTask["cadence"], string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};

const GROUP_BY_OPTIONS: RecurringGroupBy[] = ["prazo", "cliente", "responsavel"];

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "Sem data";
}

/** "hoje" / "amanhã" / "há 3 dias" — an absolute date alone makes you count in your head. */
function relativeDue(value: string | null, today: string): string | null {
  if (!value) return null;
  const days = Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  if (days < 0) return `há ${Math.abs(days)} dias`;
  if (days <= 30) return `em ${days} dias`;
  return null;
}

function RecurrenceCard({
  task,
  today,
  onOpen,
  compact = false,
  onComplete,
}: {
  task: RecurringTask;
  today: string;
  onOpen: () => void;
  compact?: boolean;
  onComplete?: () => void;
}) {
  const state = recurringState(task, today);
  const tone = RECURRING_STATE_TONE[state];
  const relative = relativeDue(task.next_due_date, today);

  return (
    <article className={`rec-card ${compact ? "compact" : ""}`}>
      <button type="button" className="rec-card-open" onClick={onOpen} aria-label={`Abrir rotina ${task.title}`}>
      <span className="rec-card-topline">
        <span className={`rec-state ${tone}`}>{RECURRING_STATE_LABEL[state]}</span>
      </span>
      <span className="rec-card-titleline"><TaskKindIcon kind={task.kind} /><strong>{task.title}</strong></span>
      {/* In the calendar the meta row is hidden, so without this two clients
          running the same routine render as one title twice. */}
      {compact ? <span className="rec-card-client">{task.clientName}</span> : null}
      {!compact && task.description ? <span className="rec-card-description">{task.description}</span> : null}
      <span className="rec-card-meta">
        <span>↻ {CADENCE_LABEL[task.cadence]}</span>
        <span>◷ {formatDate(task.next_due_date)}{relative ? ` · ${relative}` : ""}</span>
        {task.assignee ? <span>● {task.assignee}</span> : null}
      </span>
      </button>
      {!compact && onComplete ? <button type="button" className="rec-cycle-dot" title="Concluir ciclo" aria-label={`Concluir ciclo de ${task.title}`} onClick={onComplete}>✓</button> : null}
    </article>
  );
}

export default function ClientsWorkspace({
  clients,
  recurringTasks,
  assignees,
  recurringStorageAvailable,
}: {
  clients: ClientRow[];
  recurringTasks: RecurringTask[];
  assignees: string[];
  recurringStorageAvailable: boolean;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("recorrencias");
  const [view, setView] = useState<RecurrenceView>("colunas");
  const [groupBy, setGroupBy] = useState<RecurringGroupBy>("prazo");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<RecurringActiveFilter[]>([]);
  const [selected, setSelected] = useState<RecurringTask | null | undefined>(undefined);
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // One "today", in the agency's timezone, shared by every derived value below —
  // so the badge, the filter and the columns can never disagree about the date.
  const today = useMemo(() => todayInTimezone("America/Sao_Paulo"), []);
  const activeClients = useMemo(() => clients.filter((client) => !client.disabled), [clients]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/plano-visibility")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return recurringTasks
      .filter((task) => {
        if (!recurringMatchesFilters(task, filters, today)) return false;
        return !needle || recurringSearchText(task).includes(needle);
      })
      .sort(compareByUrgency);
  }, [filters, query, recurringTasks, today]);

  const columns = useMemo(() => groupRecurring(filtered, groupBy, today), [filtered, groupBy, today]);

  const monthRange = useMemo(() => {
    const cells = calendarMonthCells(month.getFullYear(), month.getMonth(), 1).filter((cell): cell is Date => cell !== null);
    return { start: isoCalendarDate(cells[0]), end: isoCalendarDate(cells[cells.length - 1]) };
  }, [month]);

  // Expand each routine into the days it actually runs this month, so a weekly
  // routine lands on all four of its dates instead of only its next one.
  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, RecurringTask[]>();
    for (const task of filtered) {
      for (const day of recurringOccurrences(task, monthRange.start, monthRange.end)) {
        const bucket = map.get(day);
        if (bucket) bucket.push(task);
        else map.set(day, [task]);
      }
    }
    return map;
  }, [filtered, monthRange]);

  const stats = useMemo(() => {
    const byState = (state: RecurringState) => recurringTasks.filter((task) => recurringState(task, today) === state).length;
    return {
      total: recurringTasks.length,
      clients: new Set(recurringTasks.map((task) => task.clientName)).size,
      atrasadas: byState("atrasada"),
      ativas: byState("ativa"),
      // The count of cycles ever closed — not "routines currently done", which
      // would drop every time a cycle rolls over and read as data loss.
    };
  }, [recurringTasks, today]);

  function toggleStateFilter(state: RecurringState) {
    setFilters((current) =>
      current.some((filter) => filter.attr === "estado" && filter.value === state)
        ? current.filter((filter) => filter.attr !== "estado")
        : [...current.filter((filter) => filter.attr !== "estado"), { attr: "estado", value: state, label: RECURRING_STATE_LABEL[state] }],
    );
  }

  const stateFilter = filters.find((filter) => filter.attr === "estado")?.value;

  // Same custom horizontal rail the Kanban board uses (app/admin/HScrollRail.tsx):
  // it lives in a fixed-height .kb-toparea slot so switching views never shifts
  // the layout, and it renders nothing at all when there is no overflow.
  const boardRef = useRef<HTMLDivElement>(null);

  function saved() {
    setSelected(undefined);
    router.refresh();
  }

  async function completeCycle(task: RecurringTask | TaskRecord, retried = false): Promise<void> {
    const response = await fetch(`/api/admin/tasks/${task.id}/complete-cycle`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedCycle: recurrenceCycleOf(task),
        expectedRevision: recurrenceRevisionOf(task),
        expectedDueDate: "next_due_date" in task ? task.next_due_date : task.due_date,
      }),
    });
    if (response.ok) { router.refresh(); return; }
    const body = await response.json().catch(() => null) as { code?: string; parent?: TaskRecord } | null;
    if (!retried && body?.code === "recurrence_schedule_changed" && body.parent) {
      await completeCycle(body.parent, true);
    }
  }

  return (
    <section className="admin-page kb-wide clients-workspace">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Operação</p>
          <h1 className="admin-title">Clientes</h1>
          <p className="admin-sub">Cadastros e rotinas dos clientes em um só lugar.</p>
        </div>
        <div className="clients-head-actions">
          <Link href="/admin/novo" className="admin-btn ghost">+ Novo cliente</Link>
        </div>
      </header>

      <nav className="clients-section-tabs" aria-label="Seções de clientes">
        <button type="button" className={section === "recorrencias" ? "on" : ""} onClick={() => setSection("recorrencias")}>Rotinas <span>{recurringTasks.length}</span></button>
        <button type="button" className={section === "cadastro" ? "on" : ""} onClick={() => setSection("cadastro")}>Cadastro <span>{activeClients.length}</span></button>
      </nav>

      {section === "cadastro" ? (
        clients.length ? <ClientsTable clients={clients} /> : <p className="admin-empty">Nenhum cliente ainda. Crie o primeiro.</p>
      ) : (
        <>
          <div className="rec-summary-head">
            <button type="button" className="rec-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}>
              <span>Resumo operacional</span><span className={summaryOpen ? "on" : ""} aria-hidden>⌄</span>
            </button>
          </div>
          {summaryOpen ? (
            <div className="rec-stats" aria-label="Resumo das rotinas">
              <div><strong>{stats.total}</strong><span>Rotinas</span></div>
              <div><strong>{stats.clients}</strong><span>Clientes</span></div>
              <button type="button" className={`rec-stat-btn ${stateFilter === "ativa" ? "on" : ""}`} onClick={() => toggleStateFilter("ativa")} aria-pressed={stateFilter === "ativa"}>
                <strong>{stats.ativas}</strong><span>Ativas</span>
              </button>
              <button type="button" className={`rec-stat-btn attention ${stateFilter === "atrasada" ? "on" : ""}`} onClick={() => toggleStateFilter("atrasada")} aria-pressed={stateFilter === "atrasada"}>
                <strong>{stats.atrasadas}</strong><span>Atrasadas</span>
              </button>
            </div>
          ) : null}

          <div className="rec-toolbar">
            <div className="kb-viewtabs" aria-label="Visualização das rotinas">
              <button type="button" className={view === "colunas" ? "on" : ""} onClick={() => setView("colunas")}>Colunas</button>
              <button type="button" className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
              <button type="button" className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>Calendário</button>
            </div>
            <RecurringSearchBar query={query} onQueryChange={setQuery} filters={filters} onFiltersChange={setFilters} tasks={recurringTasks} onPick={setSelected} />
            {view === "colunas" ? (
              <div className="kb-modetoggle" aria-label="Agrupar colunas por">
                {GROUP_BY_OPTIONS.map((option) => (
                  <button type="button" className={groupBy === option ? "on" : ""} key={option} onClick={() => setGroupBy(option)}>
                    {RECURRING_GROUP_BY_LABEL[option]}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="kb-spacer" />
            {recurringStorageAvailable ? (
              <button type="button" className="admin-btn primary kb-newtask-btn" onClick={() => setSelected(null)}>+ Tarefa</button>
            ) : null}
          </div>

          <div className="kb-toparea">
            {view === "colunas" ? <HScrollRail targetRef={boardRef} /> : null}
            {view === "calendario" ? (
              <div className="kb-cal-bar">
                <strong className="kb-cal-title">{calendarMonthTitle(month)}</strong>
                <button type="button" className="kb-cal-nav" aria-label="Mês anterior" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</button>
                <button type="button" className="kb-cal-nav" aria-label="Próximo mês" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</button>
                <button type="button" className="kb-cal-today" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoje</button>
              </div>
            ) : null}
          </div>

          {!filtered.length ? <div className="rec-empty"><strong>Nenhuma rotina encontrada.</strong><span>Ajuste os filtros para voltar a exibir as rotinas.</span></div> : null}

          {filtered.length && view === "colunas" ? (
            <div className="rec-board" ref={boardRef}>
              {columns.map((column) => (
                <section className="rec-column" key={column.key}>
                  <header>
                    <span className="rec-client-avatar">{column.label.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{column.label}</strong><span>{column.tasks.length} {column.tasks.length === 1 ? "rotina" : "rotinas"}</span></div>
                  </header>
                  <div className="rec-column-stack">
                    {column.tasks.map((task) => <RecurrenceCard task={task} today={today} onOpen={() => setSelected(task)} onComplete={task.active ? () => void completeCycle(task) : undefined} key={`${column.key}-${task.id}`} />)}
                  </div>
                </section>
              ))}
            </div>
          ) : null}

          {filtered.length && view === "lista" ? (
            <div className="rec-list">
              <div className="rec-list-head"><span>Tarefa recorrente</span><span>Cliente</span><span>Frequência</span><span>Próxima execução</span><span>Prioridade</span><span>Ação</span></div>
              {filtered.map((task) => {
                const state = recurringState(task, today);
                return (
                  <div className="rec-list-row-wrap" key={task.id}>
                    <button type="button" className="rec-list-row" onClick={() => setSelected(task)}>
                    <span className="rec-list-title">
                      <TaskKindIcon kind={task.kind} />
                      <span><strong>{task.title}</strong></span>
                    </span>
                    <span>{task.clientName}</span>
                    <span>{CADENCE_LABEL[task.cadence]}</span>
                    <span className={`rec-list-due ${RECURRING_STATE_TONE[state]}`}>{formatDate(task.next_due_date)}</span>
                    <span>{PRIORITY_LABEL[task.priority]}</span>
                    </button>
                    {task.active ? <button type="button" className="rec-list-complete" onClick={() => void completeCycle(task)}>✓ Concluir ciclo</button> : <span className="rec-list-complete">Histórico</span>}
                  </div>
                );
              })}
            </div>
          ) : null}

          {filtered.length && view === "calendario" ? (
            <section className="rec-calendar">
              <div className="rec-calendar-weekdays">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="rec-calendar-grid">
                {calendarMonthCells(month.getFullYear(), month.getMonth(), 1).map((date, index) => {
                  const key = date ? isoCalendarDate(date) : null;
                  const dayTasks = key ? occurrencesByDay.get(key) ?? [] : [];
                  return (
                    <div className={`rec-calendar-day ${date ? "" : "empty"} ${key === today ? "is-today" : ""}`} key={key ?? `empty-${index}`}>
                      {date ? (
                        <>
                          <time>{date.getDate()}</time>
                          {dayTasks.map((task) => <RecurrenceCard task={task} today={today} compact onOpen={() => setSelected(task)} key={`${key}-${task.id}`} />)}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      {selected ? (
        <CardModalLauncher
          task={selected}
          clientName={selected.clientName}
          clientSlug={selected.clientSlug}
          initialRelatedTasks={selected.executions}
          onClose={() => setSelected(undefined)}
          onSaved={saved}
          onDeleted={saved}
          onChanged={() => router.refresh()}
        />
      ) : selected === null ? (
        <TaskModal
          mode="new"
          task={null}
          slug=""
          clients={activeClients}
          assignees={assignees}
          clientName=""
          initialKind="operacional"
          initialRecurrence
          creationScope="routine"
          adminReviewers={[]}
          clientReviewers={[]}
          planoVisibilityOn={planoVisibilityOn}
          onClose={() => setSelected(undefined)}
          onSaved={saved}
          onDeleted={saved}
        />
      ) : null}
    </section>
  );
}
