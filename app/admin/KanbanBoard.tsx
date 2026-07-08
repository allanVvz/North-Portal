"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AttributesConfigModal from "./AttributesConfigModal";
import TaskDetailPanel from "./TaskDetailPanel";
import TaskModal from "./TaskModal";
import { useAttrVisibility } from "./kanbanAttrs";
import { COLUMNS, PRIORITY_LABEL, commentsOf, initials, taskTone } from "./kanbanShared";
import { TASK_KIND_KEYS, kindDef, kindLabel, kindTone, taskProgress } from "@/lib/taskCatalog";
import { useTaskRealtime } from "@/lib/useTaskRealtime";
import type { ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";

type ClientLite = { slug: string; name: string };
type View = "quadro" | "tabela" | "calendario";
type ModalState = { mode: "new"; initialStatus?: TaskStatus } | { mode: "edit"; taskId: string } | null;
// clientName/clientSlug are only populated when "Todos" (slug === "") is selected.
type BoardRow = TaskRecord & { clientName?: string; clientSlug?: string };

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MES_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Parse a `YYYY-MM-DD` due date; free-text prazos ("hoje", "2 dias") return null. */
function parseDue(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); return x; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

/** The calendar date a task sits on: agendamento uses its scheduled timestamp,
 *  everything else its due_date; plans use start/end (handled separately). */
function taskCalDate(t: TaskRecord): Date | null {
  if (t.scheduled_start_at) { const d = new Date(t.scheduled_start_at); if (!Number.isNaN(d.getTime())) return d; }
  return parseDue(t.due_date);
}
function horaOf(t: TaskRecord): string {
  const p = (t.payload ?? {}) as Record<string, unknown>;
  return typeof p.hora === "string" ? p.hora : "";
}

// Plan bars overlapping the 7-day window starting at `weekStartDate`, each with
// the grid columns (0–6) it should span. Shared by the week view and each row
// of the month view.
function planBarsForWeek(plans: TaskRecord[], weekStartDate: Date): { t: TaskRecord; startCol: number; endCol: number }[] {
  const weekEndDate = addDays(weekStartDate, 6);
  return plans
    .map((t) => ({ t, s: parseDue(t.start_date), e: parseDue(t.end_date) }))
    .filter(({ s, e }) => s && e && e >= weekStartDate && s <= weekEndDate)
    .map(({ t, s, e }) => ({
      t,
      startCol: Math.max(0, dayDiff(s!, weekStartDate)),
      endCol: Math.min(6, dayDiff(e!, weekStartDate)),
    }));
}

function fmtDue(value: string | null): string {
  const d = parseDue(value);
  if (!d) return "—";
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d.getDate()} ${MES[d.getMonth()]}`;
}

export default function KanbanBoard({ clients }: { clients: ClientLite[] }) {
  const [slug, setSlug] = useState(clients[0]?.slug ?? "");
  const [tasks, setTasks] = useState<BoardRow[]>([]);
  const [adminReviewers, setAdminReviewers] = useState<ReviewerCandidate[]>([]);
  const [clientReviewers, setClientReviewers] = useState<ReviewerCandidate[]>([]);
  const [view, setView] = useState<View>("quadro");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [attrCfgOpen, setAttrCfgOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fKind, setFKind] = useState<string>("");
  const [fPrio, setFPrio] = useState<TaskPriority | "">("");
  const today = useMemo(() => new Date(), []);
  const [cal, setCal] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [calMode, setCalMode] = useState<"mes" | "semana">("mes");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const { map: attrMap, save: saveAttrMap } = useAttrVisibility();

  const clientName = clients.find((c) => c.slug === slug)?.name ?? "";

  // s === "" means "Todos os clientes" — a cross-client board feed.
  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(s ? `/api/admin/tasks?slug=${encodeURIComponent(s)}` : "/api/admin/tasks", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      setError("Não foi possível carregar o quadro.");
    }
    setLoading(false);
  }, []);

  const loadReviewers = useCallback(async (s: string) => {
    if (!s) { setAdminReviewers([]); setClientReviewers([]); return; }
    try {
      const res = await fetch(`/api/admin/reviewers?slug=${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAdminReviewers(data.adminReviewers ?? []);
      setClientReviewers(data.clientReviewers ?? []);
    } catch { setAdminReviewers([]); setClientReviewers([]); }
  }, []);

  useEffect(() => {
    void load(slug); setSelectedId(null); setModalState(null);
  }, [slug, load]);

  // Keeps the board in sync when a client approves/requests adjustments from
  // the portal (or another admin tab moves a card), without a manual refresh.
  useTaskRealtime(useCallback(() => { void load(slug); }, [load, slug]));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (fKind && t.kind !== fKind) return false;
      if (fPrio && t.priority !== fPrio) return false;
      if (needle && !(`${t.title} ${t.assignee ?? ""} ${t.description ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [tasks, q, fKind, fPrio]);

  const byStatus = useMemo(() => {
    const map: Record<string, BoardRow[]> = Object.fromEntries(COLUMNS.map((c) => [c.status, []]));
    for (const t of filtered) map[t.status].push(t);
    return map;
  }, [filtered]);

  // Member tasks per plan (unfiltered — a plan's progress should reflect all its
  // tasks, not just the ones passing the current board filter).
  const membersByPlan = useMemo(() => {
    const m = new Map<string, TaskRecord[]>();
    for (const t of tasks) {
      if (!t.plan_id) continue;
      const list = m.get(t.plan_id);
      if (list) list.push(t); else m.set(t.plan_id, [t]);
    }
    return m;
  }, [tasks]);
  const progressOf = useCallback(
    (t: TaskRecord) => (kindDef(t.kind).isPlan ? taskProgress(t, membersByPlan.get(t.id) ?? []) : taskProgress(t)),
    [membersByPlan],
  );
  // plano_acao cards a task can be linked to (same client as the one being edited).
  const planCandidates = useMemo(() => {
    const editId = modalState?.mode === "edit" ? modalState.taskId : null;
    const editClient = editId ? tasks.find((t) => t.id === editId)?.client_id : null;
    return tasks
      .filter((t) => kindDef(t.kind).isPlan && (!editClient || t.client_id === editClient))
      .map((t) => ({ id: t.id, title: t.title }));
  }, [tasks, modalState]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    for (const t of filtered) {
      if (kindDef(t.kind).isPlan) continue; // plans render as bars, not day pills
      const d = taskCalDate(t);
      if (!d) continue;
      const key = dayKey(d);
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [filtered]);

  // Week view: the 7 days, the plans overlapping the week (drawn as bars), and
  // the timed/dated events per day.
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const planCards = useMemo(() => filtered.filter((t) => kindDef(t.kind).isPlan), [filtered]);
  const weekPlans = useMemo(() => planBarsForWeek(planCards, weekStart), [planCards, weekStart]);
  const weekEventsByDay = useMemo(() => {
    return weekDays.map((d) => {
      const key = dayKey(d);
      return (tasksByDay.get(key) ?? []).slice().sort((a, b) => horaOf(a).localeCompare(horaOf(b)));
    });
  }, [weekDays, tasksByDay]);
  const stepWeek = (dir: -1 | 1) => setWeekStart((w) => addDays(w, dir * 7));

  const calDays = useMemo(() => {
    const first = new Date(cal.y, cal.m, 1);
    const start = new Date(cal.y, cal.m, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cal]);
  // Month view broken into 6 week-rows, each with its day cells + the plan bars
  // spanning that row (so plans render as continuous multi-day bars, like the
  // week view).
  const monthWeeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => {
      const days = calDays.slice(w * 7, w * 7 + 7);
      return { days, plans: planBarsForWeek(planCards, days[0]) };
    }),
    [calDays, planCards],
  );
  const stepMonth = (dir: -1 | 1) => setCal((c) => {
    const d = new Date(c.y, c.m + dir, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const visibleCount = tasks.filter((t) => t.client_visible).length;
  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;
  const editingTask = modalState?.mode === "edit" ? tasks.find((t) => t.id === modalState.taskId) ?? null : null;
  // In "Todos" mode there's no single selected client — fall back to the
  // task's own client (attached by listAllTasks) for the panel/modal labels.
  const panelClientName = slug ? clientName : (selectedTask?.clientName ?? "");
  const modalClientName = slug ? clientName : (editingTask?.clientName ?? "");
  const modalSlug = slug || editingTask?.clientSlug || "";

  // Reviewer candidates are per-client — in "Todos" mode, resolve them from
  // whichever task is currently open (panel or modal) instead of `slug`.
  const reviewerSlug = slug || selectedTask?.clientSlug || editingTask?.clientSlug || "";
  useEffect(() => { void loadReviewers(reviewerSlug); }, [reviewerSlug, loadReviewers]);

  // ---- Drag and drop (replaces the old ‹ › move buttons — Figma has no such
  // affordance, cards are meant to be dragged between/within columns). ----
  const [dragId, setDragId] = useState<string | null>(null);
  const onCardDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    setDragId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }, []);
  const onCardDragEnd = useCallback(() => setDragId(null), []);
  const allowDrop = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  // Drops the dragged card into `status`, inserted just before `beforeTaskId`
  // (or appended to the end when omitted). Renumbers that column with clean
  // integer gaps and PATCHes only the tasks whose status/position actually changed.
  const dropInColumn = useCallback(async (status: TaskStatus, beforeTaskId?: string) => {
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId) return;
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;

    const columnTasks = byStatus[status].filter((t) => t.id !== draggedId);
    const insertAt = beforeTaskId ? columnTasks.findIndex((t) => t.id === beforeTaskId) : -1;
    const at = insertAt === -1 ? columnTasks.length : insertAt;
    const reordered = [...columnTasks.slice(0, at), dragged, ...columnTasks.slice(at)];
    const withPositions = reordered.map((t, i) => ({ ...t, status, position: i * 10 }));

    const changed = withPositions.filter((t) => {
      const before = tasks.find((r) => r.id === t.id);
      return !before || before.status !== t.status || before.position !== t.position;
    });
    if (changed.length === 0) return;

    setTasks((rows) => {
      const byId = new Map(withPositions.map((t) => [t.id, t]));
      return rows.map((r) => byId.get(r.id) ?? r);
    });
    try {
      await Promise.all(changed.map((t) =>
        fetch(`/api/admin/tasks/${t.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: t.status, position: t.position }),
        }),
      ));
    } catch { void load(slug); }
  }, [dragId, tasks, byStatus, load, slug]);

  // Same drag pattern, applied to the Calendário: dropping a pill on a day
  // cell just PATCHes that task's due_date to the dropped-on day.
  const [calDragOverKey, setCalDragOverKey] = useState<string | null>(null);
  const dropOnDay = useCallback(async (date: Date) => {
    const draggedId = dragId;
    setDragId(null);
    setCalDragOverKey(null);
    if (!draggedId) return;
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;
    const due = isoDate(date);
    if (dragged.due_date === due) return;
    setTasks((rows) => rows.map((r) => (r.id === draggedId ? { ...r, due_date: due } : r)));
    try {
      await fetch(`/api/admin/tasks/${draggedId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_date: due }),
      });
    } catch { void load(slug); }
  }, [dragId, tasks, load, slug]);

  function applyChanged(updated: TaskRecord) {
    setTasks((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
  }
  function applySaved(updated: TaskRecord, isNew: boolean) {
    setTasks((rows) => (isNew ? [...rows, updated] : rows.map((r) => (r.id === updated.id ? updated : r))));
    setModalState(null);
    setSelectedId(updated.id);
  }
  function applyDeleted(id: string) {
    setTasks((rows) => rows.filter((r) => r.id !== id));
    setModalState(null);
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <div className="kb">
      <div className="kb-toolbar">
        <label className="kb-clientpick">
          <span>Cliente</span>
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        {slug ? (
          <span className="kb-visible-count">{visibleCount} visível{visibleCount === 1 ? "" : "eis"} ao cliente</span>
        ) : null}
        <div className="kb-spacer" />
        <div className="kb-viewtabs">
          <button className={view === "quadro" ? "on" : ""} onClick={() => setView("quadro")}>Quadro</button>
          <button className={view === "tabela" ? "on" : ""} onClick={() => setView("tabela")}>Tabela</button>
          <button className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>Calendário</button>
        </div>
        {view === "tabela" ? <button className="admin-btn ghost" onClick={() => setAttrCfgOpen(true)}>⚙ Atributos</button> : null}
        <button
          className="admin-btn primary"
          disabled={!slug}
          title={slug ? undefined : "Selecione um cliente específico para criar uma tarefa"}
          onClick={() => { setSelectedId(null); setModalState({ mode: "new" }); }}
        >
          + Tarefa
        </button>
      </div>

      <div className="kb-filters">
        <select className="kb-filter" value={fKind} onChange={(e) => setFKind(e.target.value)}>
          <option value="">Tipo · todos</option>
          {TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <select className="kb-filter" value={fPrio} onChange={(e) => setFPrio(e.target.value as TaskPriority | "")}>
          <option value="">Prioridade · todas</option>
          {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="kb-spacer" />
        <input className="kb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefa…" />
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {loading ? <p className="admin-sub">Carregando…</p> : null}

      <div className={`kb-layout ${selectedTask ? "with-panel" : ""}`}>
        <div className="kb-main">
          {view === "calendario" ? (
            <div className="kb-cal">
              <div className="kb-cal-bar">
                {calMode === "mes" ? (
                  <>
                    <strong className="kb-cal-title">{MONTHS[cal.m]} {cal.y}</strong>
                    <button className="kb-cal-nav" onClick={() => stepMonth(-1)} aria-label="Mês anterior">‹</button>
                    <button className="kb-cal-nav" onClick={() => stepMonth(1)} aria-label="Próximo mês">›</button>
                    <button className="kb-cal-today" onClick={() => setCal({ y: today.getFullYear(), m: today.getMonth() })}>Hoje</button>
                  </>
                ) : (
                  <>
                    <strong className="kb-cal-title">{weekStart.getDate()} {MES_SHORT[weekStart.getMonth()]} – {weekEnd.getDate()} {MES_SHORT[weekEnd.getMonth()]}</strong>
                    <button className="kb-cal-nav" onClick={() => stepWeek(-1)} aria-label="Semana anterior">‹</button>
                    <button className="kb-cal-nav" onClick={() => stepWeek(1)} aria-label="Próxima semana">›</button>
                    <button className="kb-cal-today" onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</button>
                  </>
                )}
                <div className="kb-spacer" />
                <div className="kb-calmode">
                  <button className={calMode === "mes" ? "on" : ""} onClick={() => setCalMode("mes")}>Mês</button>
                  <button className={calMode === "semana" ? "on" : ""} onClick={() => setCalMode("semana")}>Semana</button>
                </div>
              </div>

              {calMode === "mes" ? (
                <>
                  <div className="kb-cal-wds">
                    {WEEKDAYS.map((w) => <div className="kb-cal-wd" key={w}>{w}</div>)}
                  </div>
                  <div className="kb-cal-weeks">
                    {monthWeeks.map((wk, wi) => (
                      <div className="kb-cal-week" key={wi}>
                        {wk.plans.length ? (
                          <div className="kb-cal-week-plans">
                            {wk.plans.map(({ t, startCol, endCol }) => (
                              <div className="kb-cal-planrow" key={t.id}>
                                <button
                                  className={`kb-week-plan tone-${taskTone(t)}`}
                                  style={{ gridColumn: `${startCol + 1} / ${endCol + 2}` }}
                                  onClick={() => setSelectedId(t.id)}
                                  title={t.title}
                                >
                                  ◆ {t.title} · {progressOf(t)}%
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="kb-cal-week-days">
                          {wk.days.map((d) => {
                            const key = dayKey(d);
                            const outside = d.getMonth() !== cal.m;
                            const isToday = key === dayKey(today);
                            const items = tasksByDay.get(key) ?? [];
                            return (
                              <div
                                className={`kb-cal-cell${outside ? " out" : ""}${isToday ? " today" : ""}${calDragOverKey === key ? " dragover" : ""}`}
                                key={d.toISOString()}
                                onDragOver={allowDrop}
                                onDragEnter={() => setCalDragOverKey(key)}
                                onDragLeave={() => setCalDragOverKey((k) => (k === key ? null : k))}
                                onDrop={(e) => { e.preventDefault(); void dropOnDay(d); }}
                              >
                                <span className="kb-cal-daynum">{d.getDate()}</span>
                                <div className="kb-cal-items">
                                  {items.map((t) => (
                                    <button
                                      className={`kb-cal-pill tone-${taskTone(t)} ${dragId === t.id ? "dragging" : ""}`}
                                      key={t.id}
                                      draggable
                                      onDragStart={(e) => onCardDragStart(e, t.id)}
                                      onDragEnd={onCardDragEnd}
                                      onClick={() => setSelectedId(t.id)}
                                      title={t.title}
                                    >
                                      {t.title}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="kb-cal-hint">Planos de Ação atravessam os dias como barras; agendamentos e tarefas caem no seu prazo/data.</p>
                </>
              ) : (
                <div className="kb-week">
                  <div className="kb-week-head">
                    {weekDays.map((d) => (
                      <div className={`kb-week-wd${dayKey(d) === dayKey(today) ? " today" : ""}`} key={d.toISOString()}>
                        <span>{WEEKDAYS[d.getDay()]}</span><strong>{d.getDate()}</strong>
                      </div>
                    ))}
                  </div>
                  {weekPlans.length ? (
                    <div className="kb-week-plans">
                      {weekPlans.map(({ t, startCol, endCol }) => (
                        <div className="kb-week-planrow" key={t.id}>
                          <button
                            className={`kb-week-plan tone-${taskTone(t)}`}
                            style={{ gridColumn: `${startCol + 1} / ${endCol + 2}` }}
                            onClick={() => setSelectedId(t.id)}
                            title={t.title}
                          >
                            ◆ {t.title} · {progressOf(t)}%
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="kb-week-grid">
                    {weekDays.map((d, i) => (
                      <div
                        className={`kb-week-col${calDragOverKey === dayKey(d) ? " dragover" : ""}`}
                        key={d.toISOString()}
                        onDragOver={allowDrop}
                        onDragEnter={() => setCalDragOverKey(dayKey(d))}
                        onDragLeave={() => setCalDragOverKey((k) => (k === dayKey(d) ? null : k))}
                        onDrop={(e) => { e.preventDefault(); void dropOnDay(d); }}
                      >
                        {weekEventsByDay[i].map((t) => (
                          <button
                            className={`kb-week-event tone-${taskTone(t)} ${dragId === t.id ? "dragging" : ""}`}
                            key={t.id}
                            draggable
                            onDragStart={(e) => onCardDragStart(e, t.id)}
                            onDragEnd={onCardDragEnd}
                            onClick={() => setSelectedId(t.id)}
                            title={t.title}
                          >
                            {horaOf(t) ? <b>{horaOf(t)} </b> : null}{t.title}
                          </button>
                        ))}
                        {weekEventsByDay[i].length === 0 ? <span className="kb-week-empty">—</span> : null}
                      </div>
                    ))}
                  </div>
                  <p className="kb-cal-hint">Planos como barras no topo; agendamentos mostram o horário. Arraste um evento para outro dia.</p>
                </div>
              )}
            </div>
          ) : view === "quadro" ? (
            <div className="kb-board">
              {COLUMNS.map((col) => (
                <div
                  className={`kb-col ${dragId ? "drop-target" : ""}`}
                  key={col.status}
                  onDragOver={allowDrop}
                  onDrop={(e) => { e.preventDefault(); void dropInColumn(col.status); }}
                >
                  <div className="kb-col-head">
                    <span>{col.label}</span>
                    <em>{byStatus[col.status].length}</em>
                  </div>
                  <div className="kb-col-body">
                    {byStatus[col.status].map((t) => (
                      <article
                        className={`kb-card ${selectedId === t.id ? "sel" : ""} ${dragId === t.id ? "dragging" : ""}`}
                        key={t.id}
                        draggable
                        onDragStart={(e) => onCardDragStart(e, t.id)}
                        onDragEnd={onCardDragEnd}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void dropInColumn(col.status, t.id); }}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <div className="kb-card-top">
                          <span className={`kb-type t-tone-${kindTone(t.kind)}`}>{kindLabel(t.kind)}</span>
                          {!slug && t.clientName ? <span className="kb-card-client">{t.clientName}</span> : null}
                          {t.client_visible ? <span className="kb-eye" title="Visível ao cliente">◉</span> : null}
                        </div>
                        <p className="kb-card-title">{t.title}</p>
                        <div className="kb-card-progress">
                          <div className="kb-card-progress-track"><div className="kb-card-progress-fill" style={{ width: `${progressOf(t)}%` }} /></div>
                          <span>{progressOf(t)}%</span>
                        </div>
                        <div className="kb-card-foot">
                          {t.assignee ? <span className="kb-assignee" title={t.assignee}>{initials(t.assignee)}</span> : <span />}
                          <span className="kb-card-foot-right">
                            {commentsOf(t).length > 0 ? (
                              <span className="kb-comments" title="Comentários no card">💬 {commentsOf(t).length}</span>
                            ) : null}
                            <span className={`kb-prio p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                          </span>
                        </div>
                      </article>
                    ))}
                    {byStatus[col.status].length === 0 ? <p className="kb-empty">Arraste um card aqui</p> : null}
                  </div>
                  <button
                    type="button"
                    className="kb-col-add"
                    disabled={!slug}
                    title={slug ? undefined : "Selecione um cliente específico para criar uma tarefa"}
                    onClick={() => { setSelectedId(null); setModalState({ mode: "new", initialStatus: col.status }); }}
                  >
                    + Adicionar tarefa
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="kb-table-wrap">
              <table className="kb-table">
                <thead><tr><th>Tarefa</th><th>Tipo</th><th>Etapa</th><th>Resp.</th><th>Prazo</th><th>Progresso</th><th>Prioridade</th><th>Cliente</th></tr></thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className={selectedId === t.id ? "sel" : ""} onClick={() => setSelectedId(t.id)}>
                      <td>
                        {t.title}
                        {!slug && t.clientName ? <span className="kb-card-client"> {t.clientName}</span> : null}
                        {commentsOf(t).length > 0 ? <span className="kb-comments" title="Comentários no card"> 💬 {commentsOf(t).length}</span> : null}
                      </td>
                      <td>{kindLabel(t.kind)}</td>
                      <td>{COLUMNS.find((c) => c.status === t.status)?.label}</td>
                      <td>{t.assignee ? <span className="kb-assignee" title={t.assignee}>{initials(t.assignee)}</span> : "—"}</td>
                      <td>{fmtDue(t.due_date)}</td>
                      <td>
                        <div className="kb-card-progress" style={{ margin: 0 }}>
                          <div className="kb-card-progress-track"><div className="kb-card-progress-fill" style={{ width: `${progressOf(t)}%` }} /></div>
                          <span>{progressOf(t)}%</span>
                        </div>
                      </td>
                      <td><span className={`kb-prio p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span></td>
                      <td>{t.client_visible ? "◉ visível" : "—"}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading ? <tr><td colSpan={8} className="kb-empty">Nenhuma tarefa encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedTask ? (
          <TaskDetailPanel
            task={selectedTask}
            clientName={panelClientName}
            adminReviewers={adminReviewers}
            clientReviewers={clientReviewers}
            planCandidates={planCandidates}
            onClose={() => setSelectedId(null)}
            onExpand={() => setModalState({ mode: "edit", taskId: selectedTask.id })}
            onChanged={applyChanged}
          />
        ) : null}
      </div>

      {modalState ? (
        <TaskModal
          mode={modalState.mode}
          task={editingTask}
          slug={modalSlug}
          clientName={modalClientName}
          initialStatus={modalState.mode === "new" ? modalState.initialStatus : undefined}
          adminReviewers={adminReviewers}
          clientReviewers={clientReviewers}
          planCandidates={planCandidates}
          clientTasks={tasks}
          onTaskPatched={applyChanged}
          onClose={() => setModalState(null)}
          onSaved={applySaved}
          onDeleted={applyDeleted}
        />
      ) : null}

      {attrCfgOpen ? (
        <AttributesConfigModal
          initial={attrMap}
          onClose={() => setAttrCfgOpen(false)}
          onSave={(map) => { saveAttrMap(map); setAttrCfgOpen(false); }}
        />
      ) : null}
    </div>
  );
}
