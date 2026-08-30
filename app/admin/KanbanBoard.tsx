"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AttributesConfigModal from "./AttributesConfigModal";
import HScrollRail from "./HScrollRail";
import KanbanSearchBar, { taskMatchesFilters, type ActiveFilter } from "./KanbanSearchBar";
import TaskDetailPanel from "./TaskDetailPanel";
import TaskModal from "./TaskModal";
import TaskKindIcon from "./TaskKindIcon";
import CardCover from "./CardCover";
import { taskCoverCandidates } from "@/lib/taskCover";
import { useAttrVisibility } from "./kanbanAttrs";
import { useSidebarEnabledPref } from "./kanbanPrefs";
import SortMenu from "./SortMenu";
import { sortItems } from "./taskSort";
import { useSortPref } from "./taskSortPrefs";
import { formatPeriod, formatShortDate, isOverdue, relativeDue } from "./taskDates";
import { todayInTimezone } from "./recurringState";
import { COLUMNS, PRIORITY_LABEL, commentsOf, taskTone, visibleColumnsFor } from "./kanbanShared";
import { formatRelativeAge } from "@/lib/comments";
import { FLOW_STEP_COUNT_KEY, kindDef, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import { useTaskRealtime } from "@/lib/useTaskRealtime";
import { parseAssignees } from "@/lib/assignees";
import { belongsToTaskScreen, childrenByParent, flowStepKeyOf, isFlowDelivery, parentIdsOf } from "@/lib/taskRelations";
import type { ClientFlowFlags, ReviewerCandidate, TaskRecord, TaskStatus } from "@/lib/validation";
import { calendarMonthDates } from "./calendarUtils";

type ClientLite = { slug: string; name: string };
type View = "quadro" | "tabela" | "calendario";
type BoardMode = "status" | "responsavel";
type ModalState =
  | { mode: "new"; initialStatus?: TaskStatus; initialAssignee?: string }
  | { mode: "edit"; taskId: string }
  | null;
// clientName/clientSlug are attached by the API for every task now that the
// board always loads the full cross-client feed.
type BoardRow = TaskRecord & { clientName?: string; clientSlug?: string };

const SEM_RESPONSAVEL = "Sem responsável";
const VIEW_TITLE: Record<View, string> = {
  quadro: "Quadro de tarefas",
  tabela: "Tabela de tarefas",
  calendario: "Calendário de tarefas",
};

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
function payloadStr(t: TaskRecord, key: string): string {
  const p = (t.payload ?? {}) as Record<string, unknown>;
  return typeof p[key] === "string" ? (p[key] as string) : "";
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

export default function KanbanBoard({ clients, assignees }: { clients: ClientLite[]; assignees: string[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deepLinkHandledRef = useRef(false);
  const [tasks, setTasks] = useState<BoardRow[]>([]);
  const [adminReviewers, setAdminReviewers] = useState<ReviewerCandidate[]>([]);
  const [flowFlags, setFlowFlags] = useState<ClientFlowFlags | null>(null);
  const [clientReviewers, setClientReviewers] = useState<ReviewerCandidate[]>([]);
  const [view, setView] = useState<View>("quadro");
  const [boardMode, setBoardMode] = useState<BoardMode>("status");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [attrCfgOpen, setAttrCfgOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const today = useMemo(() => new Date(), []);
  // "Hoje" no fuso da agência, para a tag de atraso e o texto relativo do card.
  // `today` acima é um Date local usado pela grade do calendário; misturar os
  // dois faria um card que vence hoje aparecer atrasado a partir das 21h BRT.
  const todayIso = useMemo(() => todayInTimezone("America/Sao_Paulo"), []);
  const [cal, setCal] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [calMode, setCalMode] = useState<"mes" | "semana">("mes");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const { map: attrMap, save: saveAttrMap, visible } = useAttrVisibility();
  const tableColCount = 3 + ["status", "assignee", "progress", "priority", "client_visible"].filter((k) => visible(k)).length;
  const { sidebarEnabled, setSidebarEnabled } = useSidebarEnabledPref();
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);
  // Whether ANY client currently has Revisão/Aprovação admin-enabled — drives
  // whether those Kanban columns show at all (see visibleColumns below).
  const [flowSummary, setFlowSummary] = useState({ anyRevisaoAdmin: false, anyAprovacaoAdmin: false });
  useEffect(() => {
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    fetch("/api/admin/settings/flow-flags-summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setFlowSummary(data); })
      .catch(() => {});
  }, []);

  // The board always loads the full cross-client feed now — Cliente is just
  // another composable filter (see KanbanSearchBar), not a fetch scope.
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/tasks", { cache: "no-store" });
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

  const loadFlowFlags = useCallback(async (s: string) => {
    if (!s) { setFlowFlags(null); return; }
    try {
      const res = await fetch(`/api/admin/client/${encodeURIComponent(s)}/flow-flags`);
      if (!res.ok) throw new Error();
      setFlowFlags(await res.json());
    } catch { setFlowFlags(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keeps the board in sync when a client approves/requests adjustments from
  // the portal (or another admin tab moves a card), without a manual refresh.
  useTaskRealtime(useCallback(() => { void load(); }, [load]));

  // Uma preferência por visão: o Quadro por etapa abre em "última edição", o
  // mesmo Quadro agrupado por pessoa abre em "prazo mais próximo", e a Tabela
  // guarda a sua. O Calendário é posicionado por data e não ordena.
  const sortScope = view === "tabela"
    ? "tarefas.tabela"
    : boardMode === "status" ? "tarefas.quadro.status" : "tarefas.quadro.responsavel";
  const { sort, setSort } = useSortPref(sortScope);

  const taskScreenTasks = useMemo(() => tasks.filter(belongsToTaskScreen), [tasks]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matching = taskScreenTasks.filter((t) => {
      if (!taskMatchesFilters(t, activeFilters)) return false;
      if (needle && !(`${t.title} ${t.assignee ?? ""} ${t.description ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
    // Ordenar aqui alcança Quadro (ambos os modos) e Tabela de uma vez; o
    // Calendário reordena por horário logo depois, então não é afetado.
    return sortItems(matching, sort.key, sort.dir, (t) => ({
      title: t.title,
      updatedAt: t.updated_at,
      dueDate: t.due_date,
      completedAt: t.completed_at,
      position: t.position,
    }));
  }, [taskScreenTasks, activeFilters, q, sort]);

  // Igualdade de status, sem exceção. A projeção visual que existia aqui era
  // do "Publicado" dentro de Concluído, e some com o estágio.
  const tasksInStatusColumn = useCallback(
    (status: TaskStatus) => filtered.filter((task) => task.status === status),
    [filtered],
  );

  // Responsável mode: one column per distinct assignee among the filtered
  // tasks — brand new names show up as a new column automatically the moment
  // a task using them is created/saved, since this is just derived from state.
  const responsavelColumns = useMemo(() => {
    const names = new Set<string>();
    for (const t of filtered) {
      const assigned = parseAssignees(t.assignee);
      if (assigned.length) for (const name of assigned) names.add(name);
      else names.add(SEM_RESPONSAVEL);
    }
    return Array.from(names).sort((a, b) => (a === SEM_RESPONSAVEL ? 1 : b === SEM_RESPONSAVEL ? -1 : a.localeCompare(b)));
  }, [filtered]);
  const byAssignee = useMemo(() => {
    const map = new Map<string, BoardRow[]>();
    for (const t of filtered) {
      const keys = parseAssignees(t.assignee);
      for (const key of keys.length ? keys : [SEM_RESPONSAVEL]) {
        const list = map.get(key);
        if (list) list.push(t); else map.set(key, [t]);
      }
    }
    return map;
  }, [filtered]);

  // Member tasks per plan (unfiltered — a plan's progress should reflect all its
  // tasks, not just the ones passing the current board filter).
  const membersByPlan = useMemo(() => {
    // Elos (plano/entrega) + plan_id (ocorrência de recorrência, a única
    // relação que ainda é coluna). Com N:N o mesmo card cai em vários baldes.
    const m = childrenByParent(tasks);
    for (const t of tasks) {
      if (!t.plan_id || parentIdsOf(t).includes(t.plan_id)) continue;
      const list = m.get(t.plan_id);
      if (list) list.push(t); else m.set(t.plan_id, [t]);
    }
    return m;
  }, [tasks]);
  // Uma entrega de fluxo entra pela mesma porta: suas etapas já caem em
  // membersByPlan por plan_id. O mapa também vai como terceiro argumento para
  // que um pai aninhado (uma entrega dentro de um Plano de Ação) seja resolvido
  // com os filhos dele em mãos, em vez de responder 0.
  const progressOf = useCallback(
    (t: TaskRecord) =>
      kindDef(t.kind).isPlan || t.recurrence_cadence || isFlowDelivery(t)
        ? taskProgress(t, membersByPlan.get(t.id) ?? [], membersByPlan)
        : taskProgress(t),
    [membersByPlan],
  );
  // Selo de etapa do card ("2/4 · Vídeo institucional"). A entrega está em
  // `tasks` (só o quadro a filtra, via belongsToTaskScreen), então nada disso
  // precisa de fetch. O número da etapa sai da POSIÇÃO entre as etapas já
  // materializadas, ordenadas por `position` (= order_index do molde) — e não
  // da contagem delas: a cascata é append-only, então reabrir o roteiro deixa
  // a captação no lugar, e contar daria 2/4 para o roteiro.
  const flowBadges = useMemo(() => {
    const badges = new Map<string, { step: number; total: number; delivery: string }>();
    for (const delivery of tasks) {
      if (!isFlowDelivery(delivery)) continue;
      const steps = (membersByPlan.get(delivery.id) ?? [])
        .filter((t) => flowStepKeyOf(t))
        .sort((a, b) => a.position - b.position);
      const total = Number(delivery.payload?.[FLOW_STEP_COUNT_KEY]) || steps.length;
      steps.forEach((step, index) => {
        badges.set(step.id, { step: index + 1, total, delivery: delivery.title });
      });
    }
    return badges;
  }, [tasks, membersByPlan]);

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
    return calendarMonthDates(cal.y, cal.m);
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

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;
  const editingTask = modalState?.mode === "edit" ? tasks.find((t) => t.id === modalState.taskId) ?? null : null;
  const panelClientName = selectedTask?.clientName ?? "Outros";
  const modalClientName = editingTask?.clientName ?? "Outros";
  const modalSlug = editingTask?.clientSlug ?? "";

  // Reviewer candidates are per-client — resolved from whichever task is
  // currently open (panel or modal); there's no board-level client scope anymore.
  const reviewerSlug = selectedTask?.clientSlug || editingTask?.clientSlug || "";
  useEffect(() => { void loadReviewers(reviewerSlug); void loadFlowFlags(reviewerSlug); }, [reviewerSlug, loadReviewers, loadFlowFlags]);

  const visibleColumns = useMemo(
    () => visibleColumnsFor(tasks, flowSummary.anyRevisaoAdmin, flowSummary.anyAprovacaoAdmin),
    [tasks, flowSummary],
  );

  const gridColCount = boardMode === "status" ? visibleColumns.length : responsavelColumns.length;

  const boardRef = useRef<HTMLDivElement>(null);

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

  // A rejected PATCH (permission denied, stale flag, whatever) must never be
  // silently swallowed — fetch() only rejects on a network failure, a 4xx/5xx
  // still resolves "successfully", so every drag handler below explicitly
  // checks res.ok, reverts the optimistic update, and surfaces the server's
  // own message instead of leaving the board showing a move that never
  // actually persisted.
  async function serverErrorMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") return body.error;
    } catch { /* non-JSON error body */ }
    return "Não foi possível salvar a alteração.";
  }

  // Drops the dragged card into `status`, inserted just before `beforeTaskId`
  // (or appended to the end when omitted). In manual order it renumbers that
  // column with clean integer gaps; in any automatic order it only moves the
  // card between stages (see below). Either way it PATCHes only the tasks whose
  // status/position actually changed.
  const dropInColumn = useCallback(async (status: TaskStatus, beforeTaskId?: string) => {
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId) return;
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;
    const before = tasks;

    // A renumeração só é honesta quando a ordem exibida É a ordem manual. Com
    // "última edição"/"alfabético"/"data" ativos, a posição na tela não vem de
    // `position`, e renumerar a coluna a partir dela sobrescreveria a ordem
    // arrastada pelo usuário com a ordem de updated_at. Nesses casos o drop faz
    // só o que o gesto significa sem ambiguidade: mover de etapa.
    const withPositions = sort.key === "manual"
      ? (() => {
          const columnTasks = tasksInStatusColumn(status).filter((t) => t.id !== draggedId);
          const insertAt = beforeTaskId ? columnTasks.findIndex((t) => t.id === beforeTaskId) : -1;
          const at = insertAt === -1 ? columnTasks.length : insertAt;
          const reordered = [...columnTasks.slice(0, at), dragged, ...columnTasks.slice(at)];
          return reordered.map((t, i) => ({
            ...t,
            status,
            position: i * 10,
          }));
        })()
      : [{ ...dragged, status }];

    const changed = withPositions.filter((t) => {
      const prior = tasks.find((r) => r.id === t.id);
      return !prior || prior.status !== t.status || prior.position !== t.position;
    });
    if (changed.length === 0) return;

    setError("");
    setTasks((rows) => {
      const byId = new Map(withPositions.map((t) => [t.id, t]));
      return rows.map((r) => byId.get(r.id) ?? r);
    });
    try {
      const results = await Promise.all(changed.map((t) =>
        fetch(`/api/admin/tasks/${t.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: t.status, position: t.position }),
        }),
      ));
      const failed = results.find((r) => !r.ok);
      if (failed) { setTasks(before); setError(await serverErrorMessage(failed)); }
    } catch {
      setTasks(before);
      setError("Não foi possível mover o card — verifique sua conexão.");
    }
  }, [dragId, tasks, tasksInStatusColumn, sort.key]);

  // Responsável mode: dropping a card onto a person's column just reassigns
  // it — no reordering/position touch, so it can't disturb the status-based
  // ordering used when the user flips back to Kanban mode.
  const dropInAssigneeColumn = useCallback(async (assigneeName: string) => {
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId) return;
    const dragged = tasks.find((t) => t.id === draggedId);
    if (!dragged) return;
    const nextAssignee = assigneeName === SEM_RESPONSAVEL ? null : assigneeName;
    if ((dragged.assignee ?? null) === nextAssignee) return;
    const before = tasks;
    setError("");
    setTasks((rows) => rows.map((r) => (r.id === draggedId ? { ...r, assignee: nextAssignee } : r)));
    try {
      const res = await fetch(`/api/admin/tasks/${draggedId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: nextAssignee }),
      });
      if (!res.ok) { setTasks(before); setError(await serverErrorMessage(res)); }
    } catch {
      setTasks(before);
      setError("Não foi possível mover o card — verifique sua conexão.");
    }
  }, [dragId, tasks]);

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
    const before = tasks;
    setError("");
    setTasks((rows) => rows.map((r) => (r.id === draggedId ? { ...r, due_date: due } : r)));
    try {
      const res = await fetch(`/api/admin/tasks/${draggedId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_date: due }),
      });
      if (!res.ok) { setTasks(before); setError(await serverErrorMessage(res)); }
    } catch {
      setTasks(before);
      setError("Não foi possível mover o card — verifique sua conexão.");
    }
  }, [dragId, tasks]);

  // Opening the modal directly is the default; when the "painel lateral"
  // preference is on, the sidebar (TaskDetailPanel) becomes the intermediate
  // step before the full modal.
  function openTask(id: string) {
    if (sidebarEnabled) setSelectedId(id);
    else { setSelectedId(null); setModalState({ mode: "edit", taskId: id }); }
  }

  // "Copiar link" on a card points here with ?task=<id> — resolve it once
  // per page load (fetching the full record even if it isn't in the current
  // board feed, e.g. a filtered-out plan activity) and strip the param so a
  // later reload/close doesn't reopen the same card.
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const id = searchParams.get("task");
    if (!id) return;
    deepLinkHandledRef.current = true;
    fetch(`/api/admin/tasks/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((found) => { if (found) { applyChanged(found); openTask(id); } })
      .catch(() => { /* bad/stale link; board just opens normally */ });
    router.replace("/admin/kanban", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function applyChanged(updated: TaskRecord) {
    setTasks((rows) => {
      if (rows.some((r) => r.id === updated.id)) return rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
      const parent = rows.find((r) => r.id === updated.plan_id);
      return [...rows, { ...updated, clientName: parent?.clientName ?? "Outros", clientSlug: parent?.clientSlug ?? "" }];
    });
  }
  function applySaved(updated: TaskRecord, isNew: boolean) {
    setTasks((rows) => (isNew ? [...rows, updated] : rows.map((r) => (r.id === updated.id ? updated : r))));
    setModalState(null);
    if (sidebarEnabled) setSelectedId(updated.id);
  }
  function applyDeleted(id: string) {
    setTasks((rows) => rows.filter((r) => r.id !== id));
    setModalState(null);
    if (selectedId === id) setSelectedId(null);
  }

  // Shared card renderer for both column schemes (status and responsável) —
  // only the drop target differs.
  function renderCard(t: BoardRow, onDropBefore: () => void) {
    const formato = payloadStr(t, "formato");
    const plataforma = payloadStr(t, "plataforma");
    const showFormato = visible("formato") && Boolean(formato);
    const showPlataforma = visible("plataforma") && Boolean(plataforma);
    const overdue = isOverdue(t.due_date, todayIso, t.status);
    const dueRelative = relativeDue(t.due_date, todayIso);
    const period = formatPeriod(t.start_date, t.end_date);
    const coverCandidates = taskCoverCandidates(t);
    const flowBadge = visible("flow_step") ? flowBadges.get(t.id) ?? null : null;
    return (
      <article
        className={`kb-card ${selectedId === t.id ? "sel" : ""} ${dragId === t.id ? "dragging" : ""}`}
        key={t.id}
        draggable
        onDragStart={(e) => onCardDragStart(e, t.id)}
        onDragEnd={onCardDragEnd}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBefore(); }}
        onClick={() => openTask(t.id)}
      >
        {coverCandidates.length ? <CardCover candidates={coverCandidates} title={t.title} className="kb-card-cover" /> : null}
        <div className="kb-card-top">
          {t.clientName ? <span className="kb-card-client">{t.clientName}</span> : null}
          {visible("client_visible") && t.client_visible ? <span className="kb-eye" title="Visível ao cliente">◉</span> : null}
          {visible("plan_link") && parentIdsOf(t).length ? <span className="kb-plan-link" title="Vinculado a um pai (plano ou entrega)">◆</span> : null}
          {t.recurrence_cadence || t.payload?.recurrence_parent_id ? <span className="kb-recurrence-mark" title={t.recurrence_cadence ? "Tarefa recorrente" : "Execução de uma recorrência"}>↻</span> : null}
        </div>
        <div className="kb-card-titleline"><TaskKindIcon kind={t.kind} /><p className="kb-card-title">{t.title}</p></div>
        {flowBadge ? (
          <div className="kb-card-meta">
            <span className="kb-card-pill kb-flow-step" title={`Etapa ${flowBadge.step} de ${flowBadge.total} · ${flowBadge.delivery}`}>
              {flowBadge.step}/{flowBadge.total} · {subtypeLabel(t.subtype) || "Etapa"}
            </span>
          </div>
        ) : null}
        {showFormato || showPlataforma ? (
          <div className="kb-card-meta">
            {showFormato ? <span className="kb-card-pill">{formato}</span> : null}
            {showPlataforma ? <span className="kb-card-pill">{plataforma}</span> : null}
          </div>
        ) : null}
        <div className="kb-card-dates">
          {overdue ? <span className="kb-state overdue">Atrasado</span> : null}
          <span className="kb-card-due">◷ {formatShortDate(t.due_date)}{dueRelative ? ` · ${dueRelative}` : ""}</span>
        </div>
        {period ? <div className="kb-card-periodrow"><span className="kb-card-period">▦ {period}</span></div> : null}
        {visible("progress") ? (
          <div className="kb-card-progress">
            <div className="kb-card-progress-track"><div className="kb-card-progress-fill" style={{ width: `${progressOf(t)}%` }} /></div>
            <span>{progressOf(t)}%</span>
          </div>
        ) : null}
        <div className="kb-card-foot">
          {t.assignee ? <span className="kb-assignee" title={t.assignee}>● {t.assignee}</span> : <span />}
          <span className="kb-card-foot-right">
            <span className="kb-updated" title="Última atualização">{formatRelativeAge(t.updated_at)}</span>
            {commentsOf(t).length > 0 ? (
              <span className="kb-comments" title="Comentários no card">💬 {commentsOf(t).length}</span>
            ) : null}
            {visible("priority") ? <span className={`kb-prio p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span> : null}
          </span>
        </div>
      </article>
    );
  }

  return (
    <div className="kb">
      <header className="admin-head"><div><h1 className="admin-title">{VIEW_TITLE[view]}</h1></div></header>
      <div className="kb-toolbar">
        <div className="kb-viewtabs">
          <button className={view === "quadro" ? "on" : ""} onClick={() => setView("quadro")}>Quadro</button>
          <button className={view === "tabela" ? "on" : ""} onClick={() => setView("tabela")}>Tabela</button>
          <button className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>Calendário</button>
        </div>
        <KanbanSearchBar
          q={q}
          onQChange={setQ}
          filters={activeFilters}
          onFiltersChange={setActiveFilters}
          tasks={taskScreenTasks}
          onPickTask={openTask}
        />
        <span className={`kb-loadspin ${loading ? "on" : ""}`} role="status" aria-label={loading ? "Carregando" : undefined} aria-hidden={!loading} />
        {view === "quadro" ? (
          <div className="kb-modetoggle">
            <button className={boardMode === "status" ? "on" : ""} onClick={() => setBoardMode("status")}>Kanban</button>
            <button className={boardMode === "responsavel" ? "on" : ""} onClick={() => setBoardMode("responsavel")}>Responsável</button>
          </div>
        ) : view === "calendario" ? (
          <div className="kb-modetoggle">
            <button className={calMode === "mes" ? "on" : ""} onClick={() => setCalMode("mes")}>Mês</button>
            <button className={calMode === "semana" ? "on" : ""} onClick={() => setCalMode("semana")}>Semana</button>
          </div>
        ) : null}
        <div className="kb-spacer" />
        <button
          className="admin-btn primary kb-newtask-btn"
          onClick={() => { setSelectedId(null); setModalState({ mode: "new" }); }}
        >
          + Tarefa
        </button>
        {view !== "calendario" ? (
          <SortMenu sort={sort} onChange={setSort} allowManual={view === "quadro" && boardMode === "status"} />
        ) : null}
        <button className="admin-btn ghost kb-attrs-gear" onClick={() => setAttrCfgOpen(true)} aria-label="Atributos" title="Atributos">⚙</button>
      </div>

      {/* One fixed-height slot, shared by all three views, so switching
          between them never shifts anything below it. Quadro puts the
          horizontal scroll rail here; Calendário puts its month/week nav bar
          here (moved out of .kb-cal so it shares this same slot instead of
          having its own separate space); Tabela has nothing to put here, but
          the slot still holds the line so the table starts at the same y as
          the board/calendar do. When a view's content doesn't need anything
          visual (e.g. the rail with nothing to scroll), it renders nothing
          at all — not even a faint placeholder — the fixed height alone is
          what keeps everything from moving. */}
      <div className="kb-toparea">
        {view === "quadro" ? <HScrollRail targetRef={boardRef} /> : null}
        {view === "calendario" ? (
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
          </div>
        ) : null}
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className={`kb-layout ${selectedTask ? "with-panel" : ""}`}>
        <div className="kb-main">
          {view === "calendario" ? (
            <div className="kb-cal">
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
                                  onClick={() => openTask(t.id)}
                                  title={t.title}
                                >
                                  <TaskKindIcon kind={t.kind} size="sm" /> {t.title}{visible("progress") ? ` · ${progressOf(t)}%` : ""}
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
                                      onClick={() => openTask(t.id)}
                                      title={t.title}
                                    >
                                      <TaskKindIcon kind={t.kind} size="sm" />{t.title}
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
                            onClick={() => openTask(t.id)}
                            title={t.title}
                          >
                            <TaskKindIcon kind={t.kind} size="sm" /> {t.title}{visible("progress") ? ` · ${progressOf(t)}%` : ""}
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
                            onClick={() => openTask(t.id)}
                            title={t.title}
                          >
                            <TaskKindIcon kind={t.kind} size="sm" />{horaOf(t) ? <b>{horaOf(t)} </b> : null}{t.title}
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
            <div className="kb-board" ref={boardRef} style={{ gridTemplateColumns: `repeat(${Math.max(gridColCount, 1)}, minmax(240px, 1fr))` }}>
              {boardMode === "status" ? (
                visibleColumns.map((col) => {
                  const columnTasks = tasksInStatusColumn(col.status);
                  return (
                  <div
                    className={`kb-col ${dragId ? "drop-target" : ""}`}
                    key={col.status}
                    onDragOver={allowDrop}
                    onDrop={(e) => { e.preventDefault(); void dropInColumn(col.status); }}
                  >
                    <div className="kb-col-head">
                      <span>{col.label}</span>
                      <em>{columnTasks.length}</em>
                    </div>
                    <div className="kb-col-body">
                      {columnTasks.map((t) => renderCard(t, () => void dropInColumn(col.status, t.id)))}
                      {columnTasks.length === 0 ? <p className="kb-empty">Arraste um card aqui</p> : null}
                    </div>
                    <button
                      type="button"
                      className="kb-col-add"
                      onClick={() => { setSelectedId(null); setModalState({ mode: "new", initialStatus: col.status }); }}
                    >
                      + Adicionar tarefa
                    </button>
                  </div>
                  );
                })
              ) : (
                responsavelColumns.map((who) => (
                  <div
                    className={`kb-col ${dragId ? "drop-target" : ""}`}
                    key={who}
                    onDragOver={allowDrop}
                    onDrop={(e) => { e.preventDefault(); void dropInAssigneeColumn(who); }}
                  >
                    <div className="kb-col-head">
                      <span>{who}</span>
                      <em>{(byAssignee.get(who) ?? []).length}</em>
                    </div>
                    <div className="kb-col-body">
                      {(byAssignee.get(who) ?? []).map((t) => renderCard(t, () => void dropInAssigneeColumn(who)))}
                      {(byAssignee.get(who) ?? []).length === 0 ? <p className="kb-empty">Arraste um card aqui</p> : null}
                    </div>
                    <button
                      type="button"
                      className="kb-col-add"
                      onClick={() => { setSelectedId(null); setModalState({ mode: "new", initialAssignee: who === SEM_RESPONSAVEL ? undefined : who }); }}
                    >
                      + Adicionar tarefa
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="kb-table-wrap">
              <table className="kb-table">
                <thead>
                  <tr>
                    <th>Tarefa</th>
                    <th>Tipo</th>
                    {visible("status") ? <th>Etapa</th> : null}
                    {visible("assignee") ? <th>Resp.</th> : null}
                    <th>Prazo</th>
                    {visible("progress") ? <th>Progresso</th> : null}
                    {visible("priority") ? <th>Prioridade</th> : null}
                    {visible("client_visible") ? <th>Cliente</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className={selectedId === t.id ? "sel" : ""} onClick={() => openTask(t.id)}>
                      <td>
                        {t.title}
                        {t.clientName ? <span className="kb-card-client"> {t.clientName}</span> : null}
                        {commentsOf(t).length > 0 ? <span className="kb-comments" title="Comentários no card"> 💬 {commentsOf(t).length}</span> : null}
                      </td>
                      <td><TaskKindIcon kind={t.kind} /></td>
                      {visible("status") ? <td>{COLUMNS.find((c) => c.status === t.status)?.label}</td> : null}
                      {visible("assignee") ? <td>{t.assignee ? <span className="kb-assignee" title={t.assignee}>● {t.assignee}</span> : "—"}</td> : null}
                      <td>{fmtDue(t.due_date)}</td>
                      {visible("progress") ? (
                        <td>
                          <div className="kb-card-progress" style={{ margin: 0 }}>
                            <div className="kb-card-progress-track"><div className="kb-card-progress-fill" style={{ width: `${progressOf(t)}%` }} /></div>
                            <span>{progressOf(t)}%</span>
                          </div>
                        </td>
                      ) : null}
                      {visible("priority") ? <td><span className={`kb-prio p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span></td> : null}
                      {visible("client_visible") ? <td>{t.client_visible ? "◉ visível" : "—"}</td> : null}
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading ? (
                    <tr><td colSpan={tableColCount} className="kb-empty">Nenhuma tarefa encontrada.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedTask ? (
          <TaskDetailPanel
            task={selectedTask}
            clientName={panelClientName}
            assignees={assignees}
            adminReviewers={adminReviewers}
            clientReviewers={clientReviewers}
            planCandidates={planCandidates}
            planoVisibilityOn={planoVisibilityOn}
            flowFlags={flowFlags}
            onClose={() => setSelectedId(null)}
            onExpand={() => setModalState({ mode: "edit", taskId: selectedTask.id })}
            onChanged={applyChanged}
          />
        ) : null}
      </div>

      {modalState ? (
        <TaskModal
          key={`${modalState.mode}:${modalState.mode === "edit" ? modalState.taskId : `${modalState.initialStatus ?? ""}:${modalState.initialAssignee ?? ""}`}`}
          mode={modalState.mode}
          task={editingTask}
          slug={modalSlug}
          clients={clients}
          assignees={assignees}
          clientName={modalClientName}
          initialStatus={modalState.mode === "new" ? modalState.initialStatus : undefined}
          initialAssignee={modalState.mode === "new" ? modalState.initialAssignee : undefined}
          creationScope="task"
          adminReviewers={adminReviewers}
          clientReviewers={clientReviewers}
          planCandidates={planCandidates}
          clientTasks={tasks}
          planoVisibilityOn={planoVisibilityOn}
          flowFlags={flowFlags}
          onTaskPatched={applyChanged}
          onOpenRelatedTask={(related) => { applyChanged(related); setModalState({ mode: "edit", taskId: related.id }); }}
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
