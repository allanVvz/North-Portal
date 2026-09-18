"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CardModalLauncher from "../CardModalLauncher";
import AttributesConfigModal from "../AttributesConfigModal";
import NewTaskButton from "../NewTaskButton";
import TaskKindIcon from "../TaskKindIcon";
import SortMenu from "../SortMenu";
import { PRIORITY_LABEL, STATUS_LABEL, visibleColumnsFor } from "../kanbanShared";
import { formatShortDate, relativeDue } from "../taskDates";
import { agencyToday, RECURRING_STATE_LABEL, RECURRING_STATE_TONE } from "../recurringState";
import { calendarMonthCells, calendarMonthTitle, isoCalendarDate } from "../calendarUtils";
import { deadlineStateOf, DEADLINE_LABEL } from "../deadlineState";
import { kindLabel, subtypeLabel } from "@/lib/taskCatalog";
import { taskMatchesQuery } from "@/lib/taskSearch";
import type { RecurringTask } from "@/lib/supabase";
import type { TaskRecord, TaskStatus } from "@/lib/validation";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { sortItems } from "../taskSort";
import { useSortPref, type SortScope } from "../taskSortPrefs";
import { recurrenceCycleOf, recurrenceRevisionOf } from "@/lib/recurrenceState";
import { useAttrVisibility } from "../kanbanAttrs";
import {
  compatibleSubtypes, factualDateOf, factualRoutineEvents, itemTypeLabels, itemTypeTags, normalizeOperationItems,
  operationMatchesFilters, operationSituation, type OperationFilter, type OperationFilterAttr, type OperationItem, type OperationTask,
} from "./operationItems";

type View = "quadro" | "lista" | "calendario";
type GroupBy = "responsavel" | "cliente" | "prazo" | "kanban";
type Selected = { task: TaskRecord; clientName: string; clientSlug: string; related?: TaskRecord[]; parent?: TaskRecord };

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "responsavel", label: "Responsável" }, { key: "cliente", label: "Clientes" },
  { key: "prazo", label: "Prazo" }, { key: "kanban", label: "Kanban" },
];
const FILTER_LABEL: Record<OperationFilterAttr, string> = {
  tipo: "Tipo", subtipo: "Subtipo", situacao: "Situação", cliente: "Cliente", frequencia: "Frequência", prioridade: "Prioridade", responsavel: "Responsável",
};
const SITUATION_LABEL: Record<string, string> = {
  ativa: "Ativa", sem_agenda: "Sem agenda", concluida: "Concluída", historico: "Histórico",
  no_prazo: "No prazo", atrasada: "Atrasada", parada: "Parada",
};
const CADENCE_LABEL: Record<string, string> = { semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };

function dateOf(task: TaskRecord): string | null {
  return factualDateOf(task);
}

function itemDue(item: OperationItem): string | null {
  return item.routine ? (item.task as RecurringTask).next_due_date : item.task.due_date;
}

function itemStateLabel(item: OperationItem, today: string): string {
  const state = operationSituation(item, today);
  if (item.routine) return RECURRING_STATE_LABEL[state as keyof typeof RECURRING_STATE_LABEL] ?? state;
  return DEADLINE_LABEL[state as keyof typeof DEADLINE_LABEL] ?? state;
}
function itemStateTone(item: OperationItem, today: string): string {
  const state = operationSituation(item, today);
  if (item.routine) return RECURRING_STATE_TONE[state as keyof typeof RECURRING_STATE_TONE] ?? "paused";
  return state === "atrasada" ? "overdue" : state === "concluida" ? "complete" : state === "parada" ? "paused" : "active";
}

function initialOf(value: string) { return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "—"; }

function BoardCard({ item, today, onOpen, onComplete, draggable, onDragStart, onDragEnd, visible }: {
  item: OperationItem; today: string; onOpen: () => void; onComplete?: () => void; draggable: boolean;
  onDragStart: (event: React.DragEvent) => void; onDragEnd: () => void; visible: (key: string) => boolean;
}) {
  const due = itemDue(item);
  const routine = item.routine ? item.task as RecurringTask : null;
  return <article className={`rec-card op-card${routine ? " is-routine" : ""}`} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <button type="button" className="rec-card-open" onClick={onOpen} aria-label={`Abrir ${routine ? "rotina" : "tarefa"} ${item.task.title}`}>
      <span className="rec-card-topline"><span className={`rec-state ${itemStateTone(item, today)}`}>{itemStateLabel(item, today)}</span>{routine ? <span className="op-routine-mark">↻ Rotina</span> : null}</span>
      <span className="rec-card-titleline"><TaskKindIcon kind={item.task.kind} /><strong>{item.task.title}</strong></span>
      <span className="rec-card-meta">
        <span>{item.clientName}</span>
        {visible("kind") ? <span>{kindLabel(item.task.kind)}</span> : null}
        {visible("subtype") && item.task.subtype ? <span>{subtypeLabel(item.task.subtype)}</span> : null}
        {routine ? <span>↻ {CADENCE_LABEL[routine.cadence]}</span> : null}
        <span>◷ {formatShortDate(due)}{routine && relativeDue(due, today) ? ` · ${relativeDue(due, today)}` : ""}</span>
        {visible("priority") ? <span>{PRIORITY_LABEL[item.task.priority]}</span> : null}
        {visible("assignee") ? <span>{item.task.assignee || "Sem responsável"}</span> : null}
      </span>
    </button>
    {routine?.active ? <button type="button" className="rec-cycle-dot" onClick={onComplete} title="Concluir ciclo" aria-label={`Concluir ciclo de ${item.task.title}`}>✓</button> : null}
  </article>;
}

export default function TarefasRotinasBoard({ clients, assignees, initialRoutines }: {
  clients: { slug: string; name: string; disabled?: boolean }[]; assignees: string[]; initialRoutines: RecurringTask[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledDeepLink = useRef<string | null>(null);
  const [tasks, setTasks] = useState<OperationTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [routines, setRoutines] = useState(initialRoutines);
  const [catalogTypes, setCatalogTypes] = useState<TaskTypeDef[]>([]);
  const [flowSummary, setFlowSummary] = useState({ anyRevisaoAdmin: false, anyAprovacaoAdmin: false });
  const [view, setView] = useState<View>("quadro");
  const [groupBy, setGroupBy] = useState<GroupBy>("responsavel");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<OperationFilter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<OperationFilterAttr | null>(null);
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
  }, [searchParams]);
  const filtered = useMemo(() => sortItems(allItems.filter((item) => operationMatchesFilters(item, filters, today) && taskMatchesQuery(item.task, query, { clientName: item.clientName, extra: itemTypeLabels(item) })), sort.key, sort.dir, (item) => ({
    title: item.task.title, updatedAt: item.task.updated_at, dueDate: itemDue(item), completedAt: item.task.completed_at, position: item.task.position,
  })), [allItems, filters, today, query, sort]);

  const summary = useMemo(() => ({
    total: filtered.length, routines: filtered.filter((item) => item.routine).length,
    overdue: filtered.filter((item) => operationSituation(item, today) === "atrasada").length,
    clients: new Set(filtered.map((item) => item.clientName)).size,
  }), [filtered, today]);

  const selectedTypes = filters.filter((filter) => filter.attr === "tipo").map((filter) => filter.value);
  const optionValues = useMemo(() => {
    if (!pendingAttr) return [] as { value: string; label: string }[];
    if (pendingAttr === "situacao") {
      return [...new Set(allItems.map((item) => operationSituation(item, today)))].map((value) => ({ value, label: SITUATION_LABEL[value] ?? value }));
    }
    if (pendingAttr === "tipo") {
      const entries: [string, string][] = [
        ...catalogTypes.map((type): [string, string] => [type.key, type.label]),
        ...allItems.flatMap(itemTypeTags).map((value): [string, string] => [value, value === "rotina" ? "Rotina" : kindLabel(value)]),
        ["rotina", "Rotina"],
      ];
      return [...new Map(entries).entries()].map(([value, label]) => ({ value, label }));
    }
    if (pendingAttr === "subtipo") {
      const catalog = catalogTypes.filter((type) => selectedTypes.filter((key) => key !== "rotina").includes(type.key)).flatMap((type) => [...type.subtypes, ...type.workflowSteps].map((subtype) => ({ value: subtype.key, label: subtype.label })));
      const present = compatibleSubtypes(allItems, selectedTypes).map((value) => ({ value, label: subtypeLabel(value) }));
      return [...new Map([...catalog, ...present].map((option) => [option.value, option])).values()];
    }
    if (pendingAttr === "cliente") return [...new Set(allItems.map((item) => item.clientName))].sort().map((value) => ({ value, label: value }));
    if (pendingAttr === "frequencia") return ["semanal", "quinzenal", "mensal"].map((value) => ({ value, label: CADENCE_LABEL[value] }));
    if (pendingAttr === "prioridade") return Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
    return [...new Set(allItems.flatMap((item) => (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean)))].sort().concat(allItems.some((item) => !item.task.assignee) ? ["Sem responsável"] : []).map((value) => ({ value, label: value }));
  }, [allItems, pendingAttr, selectedTypes, today, catalogTypes]);
  const attrs = (Object.keys(FILTER_LABEL) as OperationFilterAttr[]).filter((attr) => (attr !== "subtipo" || selectedTypes.length > 0));

  const groups = useMemo(() => {
    const map = new Map<string, OperationItem[]>();
    const put = (key: string, item: OperationItem) => map.set(key, [...(map.get(key) ?? []), item]);
    if (groupBy === "cliente") {
      clients.filter((client) => !client.disabled).forEach((client) => map.set(client.name, []));
      filtered.forEach((item) => put(item.clientName, item));
    } else if (groupBy === "responsavel") {
      assignees.forEach((assignee) => map.set(assignee, [])); map.set("Sem responsável", []);
      filtered.forEach((item) => {
        const names = (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean);
        (names.length ? names : ["Sem responsável"]).forEach((name) => put(name, item));
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
    if (groupBy === "responsavel") void patch(item, { assignee: column === "Sem responsável" ? null : column, assignee_profile_ids: [] });
    if (groupBy === "cliente") { const client = clients.find((entry) => entry.name === column); if (client) void patch(item, { slug: client.slug }); }
    if (groupBy === "kanban" && !item.routine) void patch(item, { status: column });
  }
  function addFilter(value: string, label: string) {
    if (!pendingAttr) return;
    const next = pendingAttr === "tipo" ? [...filters.filter((filter) => !(filter.attr === "tipo" && filter.value === value)), { attr: "tipo" as const, value, label }] : [...filters.filter((filter) => filter.attr !== pendingAttr), { attr: pendingAttr, value, label }];
    const types = next.filter((filter) => filter.attr === "tipo").map((filter) => filter.value);
    const validSubtypes = new Set([
      ...compatibleSubtypes(allItems, types),
      ...catalogTypes.filter((type) => types.filter((key) => key !== "rotina").includes(type.key)).flatMap((type) => [...type.subtypes, ...type.workflowSteps].map((subtype) => subtype.key)),
    ]);
    setFilters(next.filter((filter) => filter.attr !== "subtipo" || validSubtypes.has(filter.value))); setPendingAttr(null); setFilterOpen(false);
  }
  function removeFilter(index: number) {
    const next = filters.filter((_, at) => at !== index);
    setFilters(next.some((filter) => filter.attr === "tipo") ? next : next.filter((filter) => filter.attr !== "subtipo"));
  }
  const events = useMemo(() => factualRoutineEvents(routines), [routines]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, { item: OperationItem; factual: boolean }[]>();
    for (const item of filtered.filter((row) => !row.routine)) { const date = dateOf(item.task); if (date) map.set(date, [...(map.get(date) ?? []), { item, factual: false }]); }
    for (const event of events) {
      const item = filtered.find((row) => row.id === event.routine.id); if (item) map.set(event.date, [...(map.get(event.date) ?? []), { item, factual: true }]);
    }
    return map;
  }, [events, filtered]);

  return <div className="op-workspace">
    <div className="rec-summary-head"><button type="button" className="rec-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((open) => !open)}><span>Resumo operacional</span><span aria-hidden>{summaryOpen ? "⌃" : "⌄"}</span></button></div>
    {summaryOpen ? <div className="rec-stats" aria-label="Resumo operacional"><div><strong>{summary.total}</strong><span>Cards</span></div><button type="button" className="rec-stat-btn" onClick={() => setFilters((current) => current.some((filter) => filter.attr === "tipo" && filter.value === "rotina") ? current : [...current, { attr: "tipo", value: "rotina", label: "Rotina" }])}><strong>{summary.routines}</strong><span>Rotinas</span></button><button type="button" className="rec-stat-btn attention" onClick={() => setFilters((current) => [...current.filter((filter) => filter.attr !== "situacao"), { attr: "situacao", value: "atrasada", label: "Atrasada" }])}><strong>{summary.overdue}</strong><span>Precisam de atenção</span></button><div><strong>{summary.clients}</strong><span>Clientes</span></div></div> : null}
    <div className="rec-toolbar">
      <div className="kb-viewtabs" aria-label="Visualização"><button className={view === "quadro" ? "on" : ""} onClick={() => setView("quadro")}>Quadro</button><button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button><button className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>Calendário</button></div>
      <div className="kb-searchbar"><div className="kb-searchbar-box"><input className="kb-searchbar-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar ou buscar tarefas e rotinas…" /><button type="button" className="kb-searchbar-quick" onClick={() => { setFilterOpen((open) => !open); setPendingAttr(null); }}>Filtros</button></div>{filterOpen ? <div className="kb-searchbar-panel">{pendingAttr ? <><div className="kb-searchbar-panelhead"><button className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button><span>{FILTER_LABEL[pendingAttr]}</span></div><div className="kb-searchbar-chips">{optionValues.map((option) => <button type="button" className="kb-chip" key={option.value} onClick={() => addFilter(option.value, option.label)}>{option.label}</button>)}</div></> : <><div className="kb-searchbar-panelhead"><span>Filtrar por atributo</span></div><div className="kb-searchbar-attrlist">{attrs.map((attr) => <button type="button" className="kb-searchbar-attr" key={attr} onClick={() => setPendingAttr(attr)}>{FILTER_LABEL[attr]}</button>)}</div></>}</div> : null}</div>
      {filters.map((filter, index) => <span className="kb-filterchip op-filter" key={`${filter.attr}:${filter.value}`}><b>{FILTER_LABEL[filter.attr]}:</b> {filter.label}<button type="button" aria-label={`Remover filtro ${filter.label}`} onClick={() => removeFilter(index)}>×</button></span>)}
      {view === "quadro" ? <div className="kb-modetoggle" aria-label="Agrupar quadro">{GROUPS.map((group) => <button type="button" key={group.key} className={groupBy === group.key ? "on" : ""} onClick={() => setGroupBy(group.key)}>{group.label}</button>)}</div> : null}
      <div className="kb-spacer" /><NewTaskButton label="+ Tarefa" className="admin-btn primary kb-newtask-btn" onCreated={() => void load()} />{view !== "calendario" ? <SortMenu sort={sort} onChange={setSort} /> : null}<button type="button" className="admin-btn ghost kb-attrs-gear" onClick={() => setAttributesOpen(true)} aria-label="Atributos" title="Atributos">⚙</button>
    </div>
    {error ? <p className="admin-error">{error}</p> : null}
    {view === "quadro" ? <div className="rec-board op-board">{groups.map((group) => <section className={`rec-column${dropKey === group.key ? " dropping" : ""}`} key={group.key} onDragOver={groupBy === "prazo" ? undefined : (event) => { event.preventDefault(); setDropKey(group.key); }} onDragLeave={groupBy === "prazo" ? undefined : () => setDropKey(null)} onDrop={groupBy === "prazo" ? undefined : (event) => { event.preventDefault(); onDrop(group.key); }}><header><span className="rec-client-avatar">{initialOf(group.label)}</span><div><strong>{group.label}</strong><span>{group.items.length} {group.items.length === 1 ? "card" : "cards"}</span></div></header><div className="rec-column-stack">{group.items.map((item) => <BoardCard key={item.id} item={item} today={today} onOpen={() => open(item)} onComplete={item.routine ? () => void complete(item) : undefined} draggable={groupBy !== "prazo" && (!item.routine || groupBy === "responsavel" || groupBy === "cliente")} onDragStart={(event) => { setDragId(item.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(null); setDropKey(null); }} visible={visible} />)}</div></section>)}</div> : null}
    {view === "lista" ? <div className="rec-list op-list"><div className="rec-list-head"><span>Card</span><span>Cliente</span><span>Tipo / subtipo</span><span>Frequência</span><span>Prazo / próxima execução</span><span>Prioridade</span><span>Responsável</span><span>Ação</span></div>{filtered.map((item) => <div className="rec-list-row-wrap" key={item.id}><button className="rec-list-row" type="button" onClick={() => open(item)}><span className="rec-list-title"><TaskKindIcon kind={item.task.kind} /><span><strong>{item.task.title}</strong>{item.routine ? <small>Rotina</small> : null}</span></span><span>{item.clientName}</span><span>{kindLabel(item.task.kind)}{item.task.subtype ? ` · ${subtypeLabel(item.task.subtype)}` : ""}</span><span>{item.routine ? CADENCE_LABEL[(item.task as RecurringTask).cadence] : "—"}</span><span>{formatShortDate(itemDue(item))}</span><span>{PRIORITY_LABEL[item.task.priority]}</span><span>{item.task.assignee || "Sem responsável"}</span></button>{item.routine && (item.task as RecurringTask).active ? <button type="button" className="rec-list-complete" onClick={() => void complete(item)}>✓ Concluir ciclo</button> : <span className="rec-list-complete">Abrir</span>}</div>)}</div> : null}
    {view === "calendario" ? <section className="rec-calendar"><div className="kb-cal-bar"><strong className="kb-cal-title">{calendarMonthTitle(month)}</strong><button type="button" className="kb-cal-nav" aria-label="Mês anterior" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</button><button type="button" className="kb-cal-nav" aria-label="Próximo mês" onClick={() => setMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</button><button type="button" className="kb-cal-today" onClick={() => setMonth(new Date())}>Hoje</button></div><div className="rec-calendar-weekdays">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div><div className="rec-calendar-grid">{calendarMonthCells(month.getFullYear(), month.getMonth(), 1).map((date, index) => { const key = date ? isoCalendarDate(date) : null; const dayEvents = key ? eventsByDay.get(key) ?? [] : []; return <div className={`rec-calendar-day ${date ? "" : "empty"} ${key === today ? "is-today" : ""}`} key={key ?? `empty-${index}`} onDragOver={key ? (event) => { const item = filtered.find((row) => row.id === dragId); if (item && !item.routine) event.preventDefault(); } : undefined} onDrop={key ? (event) => { event.preventDefault(); const item = filtered.find((row) => row.id === dragId); setDragId(null); if (item && !item.routine) void patch(item, { due_date: key }); } : undefined}>{date ? <><time>{date.getDate()}</time>{dayEvents.map(({ item, factual }, at) => <button type="button" key={`${item.id}-${at}`} className={`rec-card compact ${item.routine ? "is-routine" : ""}`} draggable={!item.routine} onDragStart={() => setDragId(item.id)} onDragEnd={() => setDragId(null)} onClick={() => open(item)} title={factual ? `Rotina · ${item.task.title}` : item.task.title}><span className="rec-card-open"><strong>{item.routine ? "↻ " : ""}{item.task.title}</strong><span className="rec-card-client">{item.clientName}</span></span></button>)}</> : null}</div>; })}</div></section> : null}
    {!filtered.length ? <div className="rec-empty"><strong>Nenhum card encontrado.</strong><span>Ajuste a busca ou os filtros para continuar.</span></div> : null}
    {selected ? <CardModalLauncher task={selected.task} clientName={selected.clientName} clientSlug={selected.clientSlug} initialRelatedTasks={selected.related} parentTask={selected.parent} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(); router.refresh(); }} onDeleted={() => { setSelected(null); void load(); router.refresh(); }} onChanged={() => void load()} /> : null}
    {attributesOpen ? <AttributesConfigModal allowedKeys={["kind", "subtype", "priority", "assignee"]} initial={attributeMap} onClose={() => setAttributesOpen(false)} onSave={(next) => { saveAttributeMap(next); setAttributesOpen(false); }} /> : null}
  </div>;
}
