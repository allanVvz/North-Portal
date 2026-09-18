"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CardModalLauncher from "../CardModalLauncher";
import AttributesConfigModal from "../AttributesConfigModal";
import HScrollRail from "../HScrollRail";
import NewTaskButton from "../NewTaskButton";
import TaskKindIcon from "../TaskKindIcon";
import SortMenu from "../SortMenu";
import { COLUMNS, PRIORITY_LABEL, STATUS_LABEL, commentsOf, visibleColumnsFor } from "../kanbanShared";
import { formatPeriod, formatShortDate, relativeDue } from "../taskDates";
import { agencyToday, RECURRING_STATE_LABEL, type RecurringState } from "../recurringState";
import { calendarMonthCells, calendarMonthTitle, isoCalendarDate } from "../calendarUtils";
import { deadlineStateOf, DEADLINE_LABEL, type DeadlineState } from "../deadlineState";
import { formatRelativeAge } from "@/lib/comments";
import { kindDef, kindLabel, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import { childrenByParent, flowStepsOf, isFlowDelivery, parentIdsOf } from "@/lib/taskRelations";
import { taskMatchesQuery } from "@/lib/taskSearch";
import type { RecurringTask } from "@/lib/supabase";
import type { TaskRecord, TaskStatus } from "@/lib/validation";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { sortItems } from "../taskSort";
import { useSortPref, type SortScope } from "../taskSortPrefs";
import { recurrenceCycleOf, recurrenceRevisionOf } from "@/lib/recurrenceState";
import { useAttrVisibility } from "../kanbanAttrs";
import OperationSearchBar, { type AttrDef, type AttrOption } from "./OperationSearchBar";
import { useOperationFilters } from "./operationFilterPrefs";
import {
  DEFAULT_OPERATION_FILTERS, MULTI_VALUE_ATTRS, compatibleSubtypes, factualDateOf, factualRoutineEvents, itemTypeLabels,
  itemTypeTags, normalizeOperationItems, operationMatchesFilters, operationSituation, type OperationFilter,
  type OperationFilterAttr, type OperationItem, type OperationTask,
} from "./operationItems";

type View = "quadro" | "lista" | "calendario";
type GroupBy = "responsavel" | "cliente" | "prazo" | "kanban";
type Selected = { task: TaskRecord; clientName: string; clientSlug: string; related?: TaskRecord[]; parent?: TaskRecord };
type FlowBadge = { step: number; total: number; delivery: string };

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "responsavel", label: "Responsável" }, { key: "cliente", label: "Clientes" },
  { key: "prazo", label: "Prazo" }, { key: "kanban", label: "Kanban" },
];
// Mesmos glifos do KanbanSearchBar, para o mesmo atributo não ter dois ícones.
const FILTER_ATTRS: AttrDef[] = [
  { key: "status", label: "Status", icon: "◧" },
  { key: "situacao", label: "Situação", icon: "◉" },
  { key: "tipo", label: "Tipo", icon: "▣" },
  { key: "subtipo", label: "Subtipo", icon: "▢" },
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "frequencia", label: "Frequência", icon: "↻" },
  { key: "prioridade", label: "Prioridade", icon: "⚑" },
  { key: "responsavel", label: "Responsável", icon: "◑" },
];
const SITUATION_LABEL: Record<string, string> = {
  ativa: "Ativa", sem_agenda: "Sem agenda", concluida: "Concluída", historico: "Histórico",
  no_prazo: "No prazo", atrasada: "Atrasada", parada: "Parada",
};
const CADENCE_LABEL: Record<string, string> = { semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };
const SEM_RESPONSAVEL = "Sem responsável";

function itemDue(item: OperationItem): string | null {
  return item.routine ? (item.task as RecurringTask).next_due_date : item.task.due_date;
}

/** A cor do card fala a língua do Kanban (`is-atrasada` vermelho, `is-parada`
 * âmbar, `is-concluida` verde — regras temáticas em globals.css). A rotina tem
 * vocabulário próprio; aqui ele é reduzido às mesmas quatro cores, e o rótulo
 * da pílula continua o da rotina ("Ativa", "Ciclo concluído"). */
function cardState(item: OperationItem, today: string): { tone: DeadlineState; label: string } {
  if (!item.routine) {
    const state = deadlineStateOf(item.task, today);
    return { tone: state, label: DEADLINE_LABEL[state] };
  }
  const state = operationSituation(item, today) as RecurringState;
  const tone: DeadlineState = state === "atrasada" || state === "parada" || state === "concluida" ? state : "no_prazo";
  return { tone, label: RECURRING_STATE_LABEL[state] ?? state };
}

function initialOf(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—"; }

function payloadStr(task: TaskRecord, key: string): string {
  const value = (task.payload ?? {})[key];
  return typeof value === "string" ? value : "";
}

function sameFilters(a: readonly OperationFilter[], b: readonly OperationFilter[]): boolean {
  const key = (filter: OperationFilter) => `${filter.attr}:${filter.value}`;
  const left = new Set(a.map(key));
  return left.size === new Set(b.map(key)).size && b.every((filter) => left.has(key(filter)));
}

function BoardCard({ item, today, onOpen, onComplete, draggable, dragging, onDragStart, onDragEnd, visible, flowBadge, progress, showStage }: {
  item: OperationItem; today: string; onOpen: () => void; onComplete?: () => void; draggable: boolean; dragging: boolean;
  onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void; visible: (key: string) => boolean;
  flowBadge: FlowBadge | null; progress: number; showStage: boolean;
}) {
  const task = item.task;
  const routine = item.routine ? task as RecurringTask : null;
  const due = itemDue(item);
  const { tone, label } = cardState(item, today);
  const dueRelative = tone === "concluida" ? null : relativeDue(due, today);
  const period = formatPeriod(task.start_date, task.end_date);
  const formato = visible("formato") ? payloadStr(task, "formato") : "";
  const plataforma = visible("plataforma") ? payloadStr(task, "plataforma") : "";
  const comments = commentsOf(task).length;
  const showKind = visible("kind");
  // Numa etapa de fluxo o selo "2/4 · Captação" já diz o subtipo.
  const showSubtype = !flowBadge && visible("subtype") && Boolean(task.subtype);
  return (
    <article
      className={`kb-card op-card is-${tone}${routine ? " is-routine" : ""}${dragging ? " dragging" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="op-card-open" onClick={onOpen} aria-label={`Abrir ${routine ? "rotina" : "tarefa"} ${task.title}`}>
        <span className="kb-card-statusline">
          <span className={`kb-situacao s-${tone}`}>{label}</span>
          {/* O status do molde ("Entrada") não diz nada sobre a rotina — o ciclo
              dela já está na pílula de situação. Só a tarefa mostra a etapa. */}
          {showStage && !routine ? <span className="kb-card-stage">{STATUS_LABEL[task.status]}</span> : null}
          <span className="kb-card-marks">
            {visible("client_visible") && task.client_visible ? <span className="kb-eye" title="Visível ao cliente">◉</span> : null}
            {visible("plan_link") && parentIdsOf(task).length ? <span className="kb-plan-link" title="Possui relação estrutural ou de fluxo">◆</span> : null}
            {routine ? <span className="op-routine-mark" title={`Rotina ${CADENCE_LABEL[routine.cadence]?.toLowerCase() ?? ""}`}>↻ {CADENCE_LABEL[routine.cadence] ?? "Rotina"}</span> : null}
          </span>
        </span>
        <span className="kb-card-titleline"><TaskKindIcon kind={task.kind} /><span className="kb-card-title op-card-title">{task.title}</span></span>
        {flowBadge || showKind || showSubtype || formato || plataforma ? (
          <span className="kb-card-meta">
            {flowBadge ? (
              <span className="kb-card-pill kb-flow-step" title={`Etapa ${flowBadge.step} de ${flowBadge.total} · ${flowBadge.delivery}`}>
                {flowBadge.step}/{flowBadge.total} · {subtypeLabel(task.subtype) || "Etapa"}
              </span>
            ) : null}
            {showKind ? <span className="kb-card-pill">{kindLabel(task.kind)}</span> : null}
            {showSubtype ? <span className="kb-card-pill">{subtypeLabel(task.subtype)}</span> : null}
            {formato ? <span className="kb-card-pill">{formato}</span> : null}
            {plataforma ? <span className="kb-card-pill">{plataforma}</span> : null}
          </span>
        ) : null}
        <span className="kb-card-facts">
          <span className="kb-card-due" title={routine ? "Próxima execução" : "Data de entrega"}>◷ {formatShortDate(due)}{dueRelative ? ` · ${dueRelative}` : ""}</span>
          {visible("assignee") ? (
            task.assignee
              ? <span className="kb-assignee" title={`Responsável: ${task.assignee}`}>● {task.assignee}</span>
              : <span className="kb-assignee is-empty">● {SEM_RESPONSAVEL}</span>
          ) : null}
          <span className="kb-card-client" title="Cliente">{item.clientName}</span>
        </span>
        {period ? <span className="kb-card-periodrow"><span className="kb-card-period">▦ {period}</span></span> : null}
        {visible("progress") ? (
          <span className="kb-card-progress">
            <span className="kb-card-progress-track"><span className="kb-card-progress-fill" style={{ width: `${progress}%` }} /></span>
            <span>{progress}%</span>
          </span>
        ) : null}
        <span className="kb-card-foot">
          <span />
          <span className="kb-card-foot-right">
            <span className="kb-updated" title="Última atualização">{formatRelativeAge(task.updated_at)}</span>
            {comments > 0 ? <span className="kb-comments" title="Comentários no card">💬 {comments}</span> : null}
            {visible("priority") ? <span className={`kb-prio p-${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span> : null}
          </span>
        </span>
      </button>
      {routine?.active && onComplete ? (
        <button type="button" className="op-cycle-btn" onClick={onComplete} title="Concluir ciclo" aria-label={`Concluir ciclo de ${task.title}`}>✓</button>
      ) : null}
    </article>
  );
}

export default function TarefasRotinasBoard({ clients, assignees, initialRoutines }: {
  clients: { slug: string; name: string; disabled?: boolean }[]; assignees: string[]; initialRoutines: RecurringTask[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledDeepLink = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<OperationTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [routines, setRoutines] = useState(initialRoutines);
  const [catalogTypes, setCatalogTypes] = useState<TaskTypeDef[]>([]);
  const [flowSummary, setFlowSummary] = useState({ anyRevisaoAdmin: false, anyAprovacaoAdmin: false });
  const [view, setView] = useState<View>("quadro");
  const [groupBy, setGroupBy] = useState<GroupBy>("responsavel");
  const [query, setQuery] = useState("");
  const { filters, setFilters, resetFilters } = useOperationFilters();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const today = useMemo(() => agencyToday(), []);
  const { map: attributeMap, save: saveAttributeMap, visible } = useAttrVisibility();
  const sortScope: SortScope = view === "lista" ? "tarefas.tabela"
    : groupBy === "responsavel" ? "tarefas.quadro.responsavel"
      : groupBy === "kanban" ? "tarefas.quadro.status"
        : groupBy === "cliente" ? "clientes.cliente" : "clientes.prazo";
  const { sort, setSort } = useSortPref(sortScope);

  const load = useCallback(async () => {
    try {
      const [taskResponse, routineResponse] = await Promise.all([fetch("/api/admin/tasks", { cache: "no-store" }), fetch("/api/admin/routines", { cache: "no-store" })]);
      if (!taskResponse.ok) throw new Error();
      const taskData = await taskResponse.json() as { tasks?: OperationTask[] };
      setTasks(taskData.tasks ?? []);
      if (routineResponse.ok) setRoutines(((await routineResponse.json()) as { tasks?: RecurringTask[] }).tasks ?? []);
    } catch { setError("Não foi possível carregar tarefas e rotinas."); } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { fetch("/api/admin/task-types").then((response) => response.ok ? response.json() : null).then((data: { types?: TaskTypeDef[] } | null) => setCatalogTypes(data?.types ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/settings/flow-flags-summary").then((response) => response.ok ? response.json() : null).then((data) => data && setFlowSummary(data)).catch(() => {}); }, []);
  useEffect(() => setRoutines(initialRoutines), [initialRoutines]);

  const allItems = useMemo(() => normalizeOperationItems(tasks, routines), [tasks, routines]);
  useEffect(() => {
    const situacao = searchParams.get("situacao");
    setFilters((current) => {
      const withoutSituation = current.filter((filter) => filter.attr !== "situacao");
      return situacao && SITUATION_LABEL[situacao]
        ? [...withoutSituation, { attr: "situacao", value: situacao, label: SITUATION_LABEL[situacao] }]
        : withoutSituation;
    });
  // setFilters is a fresh closure each render but always writes the same state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const filtered = useMemo(() => sortItems(allItems.filter((item) => operationMatchesFilters(item, filters, today) && taskMatchesQuery(item.task, query, { clientName: item.clientName, extra: itemTypeLabels(item) })), sort.key, sort.dir, (item) => ({
    title: item.task.title, updatedAt: item.task.updated_at, dueDate: itemDue(item), completedAt: item.task.completed_at, position: item.task.position,
  })), [allItems, filters, today, query, sort]);

  const summary = useMemo(() => ({
    total: filtered.length, routines: filtered.filter((item) => item.routine).length,
    overdue: filtered.filter((item) => operationSituation(item, today) === "atrasada").length,
    clients: new Set(filtered.map((item) => item.clientName)).size,
  }), [filtered, today]);

  // Progresso e selo de etapa: mesmas contas do card do Kanban (KanbanBoard.tsx),
  // sobre a lista completa de tarefas — não a filtrada —, para um plano ou uma
  // entrega refletir todos os filhos e não só os que passaram no filtro.
  const membersByPlan = useMemo(() => {
    const map = childrenByParent(tasks);
    for (const task of tasks) {
      if (!task.plan_id || parentIdsOf(task).includes(task.plan_id)) continue;
      const list = map.get(task.plan_id);
      if (list) list.push(task); else map.set(task.plan_id, [task]);
    }
    return map;
  }, [tasks]);
  const progressOf = useCallback((item: OperationItem) => {
    const task = item.task;
    if (item.routine) return taskProgress(task, (task as RecurringTask).executions, membersByPlan);
    return kindDef(task.kind).isPlan || task.recurrence_cadence || isFlowDelivery(task)
      ? taskProgress(task, membersByPlan.get(task.id) ?? [], membersByPlan)
      : taskProgress(task);
  }, [membersByPlan]);
  const flowBadges = useMemo(() => {
    const badges = new Map<string, FlowBadge>();
    for (const delivery of tasks) {
      if (!isFlowDelivery(delivery)) continue;
      const steps = flowStepsOf(delivery.id, tasks);
      const total = delivery.workflow_version?.workflow_version_steps.length || steps.length;
      steps.forEach((step, index) => badges.set(step.id, { step: index + 1, total, delivery: delivery.title }));
    }
    return badges;
  }, [tasks]);

  const selectedTypes = useMemo(() => filters.filter((filter) => filter.attr === "tipo").map((filter) => filter.value), [filters]);
  const optionsFor = useCallback((attr: OperationFilterAttr): AttrOption[] => {
    if (attr === "status") return COLUMNS.map((column) => ({ value: column.status, label: column.label }));
    if (attr === "situacao") {
      return [...new Set(allItems.map((item) => operationSituation(item, today)))].map((value) => ({ value, label: SITUATION_LABEL[value] ?? value }));
    }
    if (attr === "tipo") {
      const entries: [string, string][] = [
        ...catalogTypes.map((type): [string, string] => [type.key, type.label]),
        ...allItems.flatMap(itemTypeTags).map((value): [string, string] => [value, value === "rotina" ? "Rotina" : kindLabel(value)]),
        ["rotina", "Rotina"],
      ];
      return [...new Map(entries).entries()].map(([value, label]) => ({ value, label }));
    }
    if (attr === "subtipo") {
      const catalog = catalogTypes.filter((type) => selectedTypes.filter((key) => key !== "rotina").includes(type.key)).flatMap((type) => [...type.subtypes, ...type.workflowSteps].map((subtype) => ({ value: subtype.key, label: subtype.label })));
      const present = compatibleSubtypes(allItems, selectedTypes).map((value) => ({ value, label: subtypeLabel(value) }));
      return [...new Map([...catalog, ...present].map((option) => [option.value, option])).values()];
    }
    if (attr === "cliente") return [...new Set(allItems.map((item) => item.clientName))].sort().map((value) => ({ value, label: value }));
    if (attr === "frequencia") return ["semanal", "quinzenal", "mensal"].map((value) => ({ value, label: CADENCE_LABEL[value] }));
    if (attr === "prioridade") return Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
    const names = [...new Set(allItems.flatMap((item) => (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean)))].sort();
    return names.concat(allItems.some((item) => !item.task.assignee) ? [SEM_RESPONSAVEL] : []).map((value) => ({ value, label: value }));
  }, [allItems, selectedTypes, today, catalogTypes]);
  const attrs = FILTER_ATTRS.filter((attr) => attr.key !== "subtipo" || selectedTypes.length > 0);

  // Subtipo só vale enquanto for compatível com os Tipos escolhidos; mudar ou
  // tirar um Tipo poda o Subtipo que deixou de existir naquela interseção.
  const pruneSubtypes = useCallback((next: OperationFilter[]) => {
    const types = next.filter((filter) => filter.attr === "tipo").map((filter) => filter.value);
    if (!types.length) return next.filter((filter) => filter.attr !== "subtipo");
    const valid = new Set([
      ...compatibleSubtypes(allItems, types),
      ...catalogTypes.filter((type) => types.filter((key) => key !== "rotina").includes(type.key)).flatMap((type) => [...type.subtypes, ...type.workflowSteps].map((subtype) => subtype.key)),
    ]);
    return next.filter((filter) => filter.attr !== "subtipo" || valid.has(filter.value));
  }, [allItems, catalogTypes]);
  function toggleFilter(attr: OperationFilterAttr, option: AttrOption) {
    setFilters((current) => {
      const has = current.some((filter) => filter.attr === attr && filter.value === option.value);
      const next = MULTI_VALUE_ATTRS.includes(attr)
        ? has ? current.filter((filter) => !(filter.attr === attr && filter.value === option.value)) : [...current, { attr, value: option.value, label: option.label }]
        : has ? current.filter((filter) => filter.attr !== attr) : [...current.filter((filter) => filter.attr !== attr), { attr, value: option.value, label: option.label }];
      return pruneSubtypes(next);
    });
  }
  function removeAttr(attr: OperationFilterAttr) {
    setFilters((current) => pruneSubtypes(current.filter((filter) => filter.attr !== attr)));
  }
  const isDefaultFilters = sameFilters(filters, DEFAULT_OPERATION_FILTERS);
  const routineFilterOn = filters.some((filter) => filter.attr === "tipo" && filter.value === "rotina");
  const overdueFilterOn = filters.some((filter) => filter.attr === "situacao" && filter.value === "atrasada");

  const groups = useMemo(() => {
    const map = new Map<string, OperationItem[]>();
    const put = (key: string, item: OperationItem) => map.set(key, [...(map.get(key) ?? []), item]);
    if (groupBy === "cliente") {
      clients.filter((client) => !client.disabled).forEach((client) => map.set(client.name, []));
      filtered.forEach((item) => put(item.clientName, item));
    } else if (groupBy === "responsavel") {
      assignees.forEach((assignee) => map.set(assignee, [])); map.set(SEM_RESPONSAVEL, []);
      filtered.forEach((item) => {
        const names = (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean);
        (names.length ? names : [SEM_RESPONSAVEL]).forEach((name) => put(name, item));
      });
    } else if (groupBy === "kanban") {
      const executableTasks = allItems.filter((item) => !item.routine).map((item) => item.task);
      visibleColumnsFor(executableTasks, flowSummary.anyRevisaoAdmin, flowSummary.anyAprovacaoAdmin).forEach((column) => map.set(column.status, []));
      filtered.forEach((item) => put(item.task.status, item));
    } else {
      ["Atrasadas", "Esta semana", "Depois", "Sem agenda"].forEach((label) => map.set(label, []));
      filtered.forEach((item) => {
        const due = itemDue(item);
        const key = !due ? "Sem agenda" : due < today ? "Atrasadas" : due <= new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 7)).toISOString().slice(0, 10) ? "Esta semana" : "Depois";
        put(key, item);
      });
    }
    return [...map.entries()].map(([key, items]) => ({ key, label: groupBy === "kanban" ? STATUS_LABEL[key as TaskStatus] : key, items }));
  }, [filtered, groupBy, clients, assignees, today, allItems, flowSummary]);

  function open(item: OperationItem) { setSelected({ task: item.task, clientName: item.clientName, clientSlug: item.clientSlug, related: item.routine ? (item.task as RecurringTask).executions : undefined }); }
  useEffect(() => {
    const id = searchParams.get("task"); if (!loaded || !id || handledDeepLink.current === id) return;
    const routine = routines.find((row) => row.id === id || row.executions.some((execution) => execution.id === id));
    if (routine) {
      handledDeepLink.current = id;
      const execution = routine.executions.find((row) => row.id === id);
      if (execution) setSelected({ task: execution, clientName: routine.clientName, clientSlug: routine.clientSlug, related: routine.executions, parent: routine });
      else open({ id: routine.id, task: routine, clientName: routine.clientName, clientSlug: routine.clientSlug, routine: true });
      return;
    }
    const item = allItems.find((row) => row.id === id);
    if (item) { handledDeepLink.current = id; open(item); }
  // Deep links intentionally stay in the URL: changing area must preserve task.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, routines, allItems, loaded]);

  async function patch(item: OperationItem, body: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/admin/tasks/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { setError("Não foi possível atualizar o card."); return; }
    await load(); router.refresh();
  }
  async function complete(item: OperationItem) {
    const response = await fetch(`/api/admin/tasks/${item.id}/complete-cycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCycle: recurrenceCycleOf(item.task), expectedRevision: recurrenceRevisionOf(item.task), expectedDueDate: itemDue(item) }) });
    if (!response.ok) { setError("Não foi possível concluir este ciclo."); return; } await load(); router.refresh();
  }
  function onDrop(column: string) {
    const item = filtered.find((row) => row.id === dragId); setDragId(null); setDropKey(null); if (!item) return;
    if (groupBy === "prazo") return;
    if (item.routine && !["responsavel", "cliente"].includes(groupBy)) return;
    if (groupBy === "responsavel") void patch(item, { assignee: column === SEM_RESPONSAVEL ? null : column, assignee_profile_ids: [] });
    if (groupBy === "cliente") { const client = clients.find((entry) => entry.name === column); if (client) void patch(item, { slug: client.slug }); }
    if (groupBy === "kanban" && !item.routine) void patch(item, { status: column });
  }
  const events = useMemo(() => factualRoutineEvents(routines), [routines]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, { item: OperationItem; factual: boolean }[]>();
    for (const item of filtered.filter((row) => !row.routine)) { const date = factualDateOf(item.task); if (date) map.set(date, [...(map.get(date) ?? []), { item, factual: false }]); }
    for (const event of events) {
      const item = filtered.find((row) => row.id === event.routine.id); if (item) map.set(event.date, [...(map.get(event.date) ?? []), { item, factual: true }]);
    }
    return map;
  }, [events, filtered]);

  const empty = loaded && !filtered.length;

  return (
    <div className="op-workspace">
      <div className="op-summary">
        <button type="button" className="rec-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((isOpen) => !isOpen)}>
          <span>Resumo operacional</span>
          <span aria-hidden className={summaryOpen ? "on" : ""}>⌄</span>
        </button>
        {summaryOpen ? (
          <div className="rec-stats" aria-label="Resumo operacional">
            <div><strong>{summary.total}</strong><span>Cards</span></div>
            <button
              type="button"
              className={`rec-stat-btn${routineFilterOn ? " on" : ""}`}
              aria-pressed={routineFilterOn}
              onClick={() => routineFilterOn
                ? setFilters((current) => pruneSubtypes(current.filter((filter) => !(filter.attr === "tipo" && filter.value === "rotina"))))
                : setFilters((current) => [...current, { attr: "tipo", value: "rotina", label: "Rotina" }])}
            ><strong>{summary.routines}</strong><span>Rotinas</span></button>
            <button
              type="button"
              className={`rec-stat-btn attention${overdueFilterOn ? " on" : ""}`}
              aria-pressed={overdueFilterOn}
              onClick={() => setFilters((current) => overdueFilterOn
                ? current.filter((filter) => filter.attr !== "situacao")
                : [...current.filter((filter) => filter.attr !== "situacao"), { attr: "situacao", value: "atrasada", label: "Atrasada" }])}
            ><strong>{summary.overdue}</strong><span>Precisam de atenção</span></button>
            <div><strong>{summary.clients}</strong><span>Clientes</span></div>
          </div>
        ) : null}
      </div>

      <div className="rec-toolbar op-toolbar">
        <div className="kb-viewtabs" aria-label="Visualização">
          {(["quadro", "lista", "calendario"] as View[]).map((key) => (
            <button type="button" aria-pressed={view === key} key={key} className={view === key ? "on" : ""} onClick={() => setView(key)}>
              {key === "quadro" ? "Quadro" : key === "lista" ? "Lista" : "Calendário"}
            </button>
          ))}
        </div>
        <OperationSearchBar
          q={query}
          onQChange={setQuery}
          placeholder="Buscar tarefas e rotinas…"
          filters={filters}
          attrs={attrs}
          optionsFor={optionsFor}
          onToggle={toggleFilter}
          onRemoveAttr={removeAttr}
          onRemoveLast={() => { const last = filters.at(-1); if (last) removeAttr(last.attr); }}
          onReset={resetFilters}
          isDefault={isDefaultFilters}
        />
        {view === "quadro" ? (
          <div className="kb-modetoggle" aria-label="Agrupar quadro">
            {GROUPS.map((group) => <button type="button" key={group.key} aria-pressed={groupBy === group.key} className={groupBy === group.key ? "on" : ""} onClick={() => setGroupBy(group.key)}>{group.label}</button>)}
          </div>
        ) : null}
        <div className="kb-spacer" />
        <div className="op-toolbar-actions">
          <NewTaskButton label="+ Tarefa" className="admin-btn primary kb-newtask-btn" onCreated={() => void load()} />
          {view !== "calendario" ? <SortMenu sort={sort} onChange={setSort} /> : null}
          <button type="button" className="admin-btn ghost kb-attrs-gear" onClick={() => setAttributesOpen(true)} aria-label="Atributos do card" title="Atributos do card">⚙</button>
        </div>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      {/* Faixa fixa entre a barra e o conteúdo: a régua de rolagem no Quadro, a
          navegação do mês no Calendário. Altura reservada sempre, então trocar
          de visualização não faz o conteúdo pular. */}
      <div className="kb-toparea op-toparea">
        {view === "quadro" && !empty ? <HScrollRail targetRef={boardRef} /> : null}
        {view === "calendario" ? (
          <div className="kb-cal-bar">
            <strong className="kb-cal-title">{calendarMonthTitle(month)}</strong>
            <button type="button" className="kb-cal-nav" aria-label="Mês anterior" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</button>
            <button type="button" className="kb-cal-nav" aria-label="Próximo mês" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</button>
            <button type="button" className="kb-cal-today" onClick={() => setMonth(new Date())}>Hoje</button>
          </div>
        ) : null}
      </div>

      {view === "quadro" && !empty ? (
        <div className="op-board" ref={boardRef}>
          <div className="op-board-track">
            {groups.map((group) => (
              <section
                className={`rec-column op-column${dropKey === group.key ? " dropping" : ""}`}
                key={group.key}
                onDragOver={groupBy === "prazo" ? undefined : (event) => { event.preventDefault(); setDropKey(group.key); }}
                onDragLeave={groupBy === "prazo" ? undefined : () => setDropKey(null)}
                onDrop={groupBy === "prazo" ? undefined : (event) => { event.preventDefault(); onDrop(group.key); }}
              >
                <header>
                  <span className="rec-client-avatar">{initialOf(group.label)}</span>
                  <div><strong title={group.label}>{group.label}</strong><span>{group.items.length} {group.items.length === 1 ? "card" : "cards"}</span></div>
                </header>
                <div className="rec-column-stack">
                  {group.items.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      today={today}
                      onOpen={() => open(item)}
                      onComplete={item.routine ? () => void complete(item) : undefined}
                      draggable={groupBy !== "prazo" && (!item.routine || groupBy === "responsavel" || groupBy === "cliente")}
                      dragging={dragId === item.id}
                      onDragStart={(event) => { setDragId(item.id); event.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragId(null); setDropKey(null); }}
                      visible={visible}
                      flowBadge={visible("flow_step") ? flowBadges.get(item.id) ?? null : null}
                      progress={visible("progress") ? progressOf(item) : 0}
                      showStage={groupBy !== "kanban"}
                    />
                  ))}
                  {group.items.length === 0 ? <p className="kb-empty">{groupBy === "prazo" ? "Nada aqui" : "Arraste um card aqui"}</p> : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {view === "lista" && !empty ? (
        <div className="rec-list op-list">
          <div className="op-list-inner">
            <div className="rec-list-row-wrap op-list-headrow">
              <div className="rec-list-head"><span>Card</span><span>Cliente</span><span>Tipo / subtipo</span><span>Frequência</span><span>Prazo / próxima</span><span>Prioridade</span><span>Responsável</span></div>
              <span className="op-list-headaction">Ação</span>
            </div>
            {filtered.map((item) => {
              const { tone, label } = cardState(item, today);
              const due = itemDue(item);
              const dueRelative = tone === "concluida" ? null : relativeDue(due, today);
              return (
                <div className={`rec-list-row-wrap is-${tone}`} key={item.id}>
                  <button className="rec-list-row" type="button" onClick={() => open(item)}>
                    <span className="rec-list-title">
                      <TaskKindIcon kind={item.task.kind} />
                      <span><strong title={item.task.title}>{item.task.title}</strong><small><span className={`kb-situacao s-${tone}`}>{label}</span>{item.routine ? " ↻ Rotina" : ""}</small></span>
                    </span>
                    <span>{item.clientName}</span>
                    <span>{kindLabel(item.task.kind)}{item.task.subtype ? ` · ${subtypeLabel(item.task.subtype)}` : ""}</span>
                    <span>{item.routine ? CADENCE_LABEL[(item.task as RecurringTask).cadence] : "—"}</span>
                    <span className="rec-list-due">{formatShortDate(due)}{dueRelative ? <small className="rec-list-period">{dueRelative}</small> : null}</span>
                    <span className={`kb-prio p-${item.task.priority}`}>{PRIORITY_LABEL[item.task.priority]}</span>
                    <span className={item.task.assignee ? "" : "kb-assignee is-empty"}>{item.task.assignee || SEM_RESPONSAVEL}</span>
                  </button>
                  {item.routine && (item.task as RecurringTask).active
                    ? <button type="button" className="rec-list-complete" onClick={() => void complete(item)}>✓ Concluir ciclo</button>
                    : <button type="button" className="rec-list-complete is-quiet" onClick={() => open(item)}>Abrir</button>}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "calendario" ? (
        <section className="rec-calendar">
          <div className="rec-calendar-weekdays">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="rec-calendar-grid">
            {calendarMonthCells(month.getFullYear(), month.getMonth(), 1).map((date, index) => {
              const key = date ? isoCalendarDate(date) : null;
              const dayEvents = key ? eventsByDay.get(key) ?? [] : [];
              return (
                <div
                  className={`rec-calendar-day ${date ? "" : "empty"} ${key === today ? "is-today" : ""}`}
                  key={key ?? `empty-${index}`}
                  onDragOver={key ? (event) => { const item = filtered.find((row) => row.id === dragId); if (item && !item.routine) event.preventDefault(); } : undefined}
                  onDrop={key ? (event) => { event.preventDefault(); const item = filtered.find((row) => row.id === dragId); setDragId(null); if (item && !item.routine) void patch(item, { due_date: key }); } : undefined}
                >
                  {date ? (
                    <>
                      <time>{date.getDate()}</time>
                      {dayEvents.map(({ item, factual }, at) => (
                        <button
                          type="button"
                          key={`${item.id}-${at}`}
                          className={`rec-card compact ${item.routine ? "is-routine" : `is-${cardState(item, today).tone}`}`}
                          draggable={!item.routine}
                          onDragStart={() => setDragId(item.id)}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => open(item)}
                          title={factual ? `Rotina · ${item.task.title}` : item.task.title}
                        >
                          <span className="rec-card-open"><strong>{item.routine ? "↻ " : ""}{item.task.title}</strong><span className="rec-card-client">{item.clientName}</span></span>
                        </button>
                      ))}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {empty && view !== "calendario" ? (
        <div className="rec-empty">
          <strong>Nenhum card encontrado.</strong>
          <span>{isDefaultFilters ? "Ajuste a busca para continuar." : "Ajuste a busca ou os filtros para continuar."}</span>
          {!isDefaultFilters ? <button type="button" className="admin-btn sm" onClick={resetFilters}>Restaurar filtros padrão</button> : null}
        </div>
      ) : null}

      {selected ? <CardModalLauncher task={selected.task} clientName={selected.clientName} clientSlug={selected.clientSlug} initialRelatedTasks={selected.related} parentTask={selected.parent} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(); router.refresh(); }} onDeleted={() => { setSelected(null); void load(); router.refresh(); }} onChanged={() => void load()} /> : null}
      {attributesOpen ? (
        <AttributesConfigModal
          allowedKeys={["kind", "subtype", "flow_step", "formato", "plataforma", "assignee", "priority", "progress", "plan_link", "client_visible"]}
          initial={attributeMap}
          onClose={() => setAttributesOpen(false)}
          onSave={(next) => { saveAttributeMap(next); setAttributesOpen(false); }}
        />
      ) : null}
    </div>
  );
}
