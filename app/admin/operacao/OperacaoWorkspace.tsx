"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecurringTask } from "@/lib/supabase";
import KanbanBoard from "../KanbanBoard";
import CardCover from "../CardCover";
import { taskCoverCandidates } from "@/lib/taskCover";
import ActionPlansBoard from "../plano/ActionPlansBoard";
import ParentCardsBoard from "./ParentCardsBoard";
import type { FlowDelivery, ActionPlan } from "@/lib/supabase";
import HScrollRail from "../HScrollRail";
import RecurringSearchBar from "../RecurringSearchBar";
import { recurringMatchesFilters, recurringSearchText, type RecurringActiveFilter } from "../recurringTaskFilters";
import CardModalLauncher from "../CardModalLauncher";
import TaskModal from "../TaskModal";
import { PRIORITY_LABEL } from "../kanbanShared";
import { RECURRING_STATE_LABEL, RECURRING_STATE_TONE, recurringState, todayInTimezone, type RecurringState } from "../recurringState";
import { recurringOccurrences } from "../recurringOccurrences";
import { RECURRING_GROUP_BY_LABEL, SEM_RESPONSAVEL, groupRecurring, type RecurringGroupBy } from "../recurringGrouping";
import SortMenu from "../SortMenu";
import { sortItems } from "../taskSort";
import { useSortPref, type SortScope } from "../taskSortPrefs";
import { formatPeriod, formatShortDate, relativeDue } from "../taskDates";
import { calendarMonthCells, calendarMonthTitle, isoCalendarDate } from "../calendarUtils";
import TaskKindIcon from "../TaskKindIcon";
import { recurrenceCycleOf, recurrenceRevisionOf } from "@/lib/recurrenceState";
import type { TaskRecord } from "@/lib/validation";

type Section = "tarefas" | "entregas" | "recorrencias" | "plano";
type RecurrenceView = "colunas" | "lista" | "calendario";

const CADENCE_LABEL: Record<RecurringTask["cadence"], string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};

const GROUP_BY_OPTIONS: RecurringGroupBy[] = ["prazo", "cliente", "responsavel"];

// formatDate/relativeDue viviam aqui e por isso o card de Tarefas não tinha
// data nenhuma — agora são compartilhados em taskDates.ts.

function RecurrenceCard({
  task,
  today,
  onOpen,
  compact = false,
  onComplete,
  dragging = false,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  task: RecurringTask;
  today: string;
  onOpen: () => void;
  compact?: boolean;
  onComplete?: () => void;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  /** Só informado quando a ordem exibida é a manual — ver reorderBefore. */
  onDropBefore?: () => void;
}) {
  const state = recurringState(task, today);
  const tone = RECURRING_STATE_TONE[state];
  const relative = relativeDue(task.next_due_date, today);
  // Numa rotina, start_date é a âncora e end_date o limite da agenda: mostrar
  // as duas é "a informação completa" de uma data que na verdade é um período,
  // e não só a próxima execução.
  const period = formatPeriod(task.start_date, task.end_date);
  // Na visão compacta (calendário) o card é pequeno demais para uma capa.
  const coverCandidates = compact ? [] : taskCoverCandidates(task);

  return (
    <article
      className={`rec-card ${compact ? "compact" : ""} ${dragging ? "dragging" : ""}`}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDropBefore ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
      onDrop={onDropBefore ? (e) => { e.preventDefault(); e.stopPropagation(); onDropBefore(); } : undefined}
    >
      <button type="button" className="rec-card-open" onClick={onOpen} aria-label={`Abrir rotina ${task.title}`}>
      {coverCandidates.length ? <CardCover candidates={coverCandidates} title={task.title} className="rec-card-cover" /> : null}
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
        <span>◷ {formatShortDate(task.next_due_date)}{relative ? ` · ${relative}` : ""}</span>
        {period ? <span>▦ {period}</span> : null}
        {task.assignee ? <span>● {task.assignee}</span> : null}
      </span>
      </button>
      {!compact && onComplete ? <button type="button" className="rec-cycle-dot" title="Concluir ciclo" aria-label={`Concluir ciclo de ${task.title}`} onClick={onComplete}>✓</button> : null}
    </article>
  );
}

export default function OperacaoWorkspace({
  clients,
  plans,
  deliveries,
  recurringTasks,
  assignees,
  recurringStorageAvailable,
}: {
  clients: { slug: string; name: string; disabled?: boolean }[];
  plans: ActionPlan[];
  deliveries: FlowDelivery[];
  recurringTasks: RecurringTask[];
  assignees: string[];
  recurringStorageAvailable: boolean;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("tarefas");
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

  // Cada visão tem a sua preferência: agrupado por prazo abre no que vence
  // primeiro; por cliente ou por pessoa, no que mudou por último.
  const sortScope: SortScope = view === "colunas" ? `clientes.${groupBy}` : "clientes.lista";
  const { sort, setSort } = useSortPref(sortScope);

  // Em rotinas a data que importa é a próxima execução, não `due_date`.
  const sortRecurring = useCallback(
    (items: RecurringTask[]) => sortItems(items, sort.key, sort.dir, (task) => ({
      title: task.title,
      updatedAt: task.updated_at,
      dueDate: task.next_due_date,
      completedAt: task.completed_at,
      position: task.position,
    })),
    [sort],
  );

  // As rotinas vinham direto da prop (render do servidor). O arrasto precisa
  // de estado local para aplicar a mudança na hora e reverter se o PATCH
  // falhar — sem isso o card voltaria ao lugar só depois do router.refresh().
  const [rows, setRows] = useState(recurringTasks);
  useEffect(() => setRows(recurringTasks), [recurringTasks]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dndError, setDndError] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onCardDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    setDragId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }, []);
  const onCardDragEnd = useCallback(() => { setDragId(null); setDropTarget(null); }, []);
  const allowDrop = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  /**
   * PATCH otimista de uma rotina. fetch() só rejeita em falha de rede — um 4xx
   * resolve "com sucesso" —, então o res.ok é checado explicitamente e o
   * estado volta ao que era, com a mensagem do servidor. Deixar o quadro
   * mostrando um movimento que não persistiu é pior que não mover.
   */
  const patchRoutine = useCallback(async (id: string, body: Record<string, unknown>, optimistic: (task: RecurringTask) => RecurringTask) => {
    const before = rows;
    setDndError("");
    setRows((items) => items.map((r) => (r.id === id ? optimistic(r) : r)));
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        setRows(before);
        const payload = await res.json().catch(() => null) as { error?: string } | null;
        setDndError(payload?.error ?? "Não foi possível mover a rotina.");
        return;
      }
      router.refresh();
    } catch {
      setRows(before);
      setDndError("Não foi possível mover a rotina — verifique sua conexão.");
    }
  }, [rows, router]);

  // Colunas por cliente/responsável: soltar aplica o atributo da coluna. Por
  // prazo não: aqueles baldes são faixas derivadas de next_due_date
  // ("Esta semana", "Depois"), não um valor que se possa gravar — qual dia
  // seria "Depois"? Para mudar a data existe o calendário, onde o gesto diz
  // exatamente qual é.
  const columnDropEnabled = groupBy !== "prazo";
  const dropInColumn = useCallback(async (columnKey: string) => {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || !columnDropEnabled) return;
    const dragged = rows.find((r) => r.id === id);
    if (!dragged) return;

    if (groupBy === "cliente") {
      if (dragged.clientName === columnKey) return;
      const target = clients.find((c) => c.name === columnKey);
      if (!target) return;
      await patchRoutine(id, { slug: target.slug }, (task) => ({ ...task, clientName: target.name, clientSlug: target.slug }));
      return;
    }
    const nextAssignee = columnKey === SEM_RESPONSAVEL ? null : columnKey;
    if ((dragged.assignee ?? null) === nextAssignee) return;
    await patchRoutine(id, { assignee: nextAssignee, assignee_profile_ids: [] }, (task) => ({ ...task, assignee: nextAssignee }));
  }, [dragId, rows, groupBy, clients, columnDropEnabled, patchRoutine]);

  // Calendário: soltar num dia é o único gesto que nomeia uma data exata, e é
  // ela que vira a PRÓXIMA EXECUÇÃO — só ela. `start_date` fica onde está de
  // propósito: é a âncora da cadência, e a rota deriva dela o dia do mês das
  // rotinas mensais (route.ts: recurrence_day_of_month). Mandar as duas juntas
  // faria arrastar um card do dia 5 para o dia 12 reescrever silenciosamente a
  // regra da rotina inteira, quando o gesto só disse "esta ocorrência é dia 12".
  const dropOnDay = useCallback(async (isoDay: string) => {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id) return;
    const dragged = rows.find((r) => r.id === id);
    if (!dragged || dragged.next_due_date === isoDay) return;
    await patchRoutine(id, { due_date: isoDay }, (task) => ({ ...task, next_due_date: isoDay, due_date: isoDay }));
  }, [dragId, rows, patchRoutine]);

  // Reordenar só é honesto quando a ordem exibida É a manual. Com
  // "última edição"/"alfabético"/"data" ativos a posição na tela não vem de
  // `position`, e renumerar a partir dela sobrescreveria o arrasto do usuário
  // com a ordem de updated_at — mesma regra do quadro de Tarefas.
  const reorderEnabled = sort.key === "manual";
  const reorderBefore = useCallback(async (beforeId: string) => {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || !reorderEnabled || id === beforeId) return;
    const dragged = rows.find((r) => r.id === id);
    if (!dragged) return;
    const others = rows.filter((r) => r.id !== id);
    const at = others.findIndex((r) => r.id === beforeId);
    const reordered = at === -1 ? [...others, dragged] : [...others.slice(0, at), dragged, ...others.slice(at)];
    const renumbered = reordered.map((task, index) => ({ ...task, position: index * 10 }));
    const before = rows;
    setDndError("");
    setRows(renumbered);
    try {
      const changed = renumbered.filter((task) => (before.find((r) => r.id === task.id)?.position ?? -1) !== task.position);
      const results = await Promise.all(changed.map((task) => fetch(`/api/admin/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: task.position }),
      })));
      if (results.some((res) => !res.ok)) { setRows(before); setDndError("Não foi possível reordenar as rotinas."); return; }
      router.refresh();
    } catch {
      setRows(before);
      setDndError("Não foi possível reordenar — verifique sua conexão.");
    }
  }, [dragId, rows, reorderEnabled, router]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    const matching = rows.filter((task) => {
      if (!recurringMatchesFilters(task, filters, today)) return false;
      return !needle || recurringSearchText(task).includes(needle);
    });
    return sortRecurring(matching);
  }, [filters, query, rows, today, sortRecurring]);

  const columns = useMemo(
    () => groupRecurring(filtered, groupBy, today, sortRecurring),
    [filtered, groupBy, today, sortRecurring],
  );

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
    const byState = (state: RecurringState) => rows.filter((task) => recurringState(task, today) === state).length;
    return {
      total: rows.length,
      clients: new Set(rows.map((task) => task.clientName)).size,
      paradas: byState("parada"),
      ativas: byState("ativa"),
      // The count of cycles ever closed — not "routines currently done", which
      // would drop every time a cycle rolls over and read as data loss.
    };
  }, [rows, today]);

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
          <h1 className="admin-title">Operação</h1>
          <p className="admin-sub">Quadro, rotinas e planos de ação no mesmo lugar.</p>
        </div>
      </header>

      <nav className="clients-section-tabs" aria-label="Seções da operação">
        <button type="button" className={section === "tarefas" ? "on" : ""} onClick={() => setSection("tarefas")}>Tarefas</button>
        <button type="button" className={section === "entregas" ? "on" : ""} onClick={() => setSection("entregas")}>Entregas <span>{deliveries.length}</span></button>
        <button type="button" className={section === "recorrencias" ? "on" : ""} onClick={() => setSection("recorrencias")}>Rotinas <span>{rows.length}</span></button>
        <button type="button" className={section === "plano" ? "on" : ""} onClick={() => setSection("plano")}>Plano de Ação <span>{plans.length}</span></button>
      </nav>

      {section === "tarefas" ? (
        activeClients.length ? (
          <KanbanBoard clients={activeClients.map((c) => ({ slug: c.slug, name: c.name }))} assignees={assignees} />
        ) : (
          <p className="admin-empty">Cadastre um cliente para montar o quadro.</p>
        )
      ) : section === "entregas" ? (
        <ParentCardsBoard
          initial={deliveries}
          clients={activeClients.map((c) => ({ slug: c.slug, name: c.name }))}
          assignees={assignees}
          scope="task"
          initialKind="criativo"
          sortScope="entregas.lista"
          showStepCount
          texts={{
            newLabel: "+ Entrega",
            empty: "Nenhuma entrega em andamento. Crie uma tarefa do tipo Criativo — cada etapa concluída cria a próxima.",
            emptyQuery: "Nenhuma entrega para essa busca.",
            searchPlaceholder: "Buscar por entrega, cliente, tipo ou etapa…",
            descriptionHint: "Adicione à descrição o que esta entrega precisa ser quando ficar pronta.",
          }}
        />
      ) : section === "plano" ? (
        <ActionPlansBoard initial={plans} clients={activeClients.map((c) => ({ slug: c.slug, name: c.name }))} assignees={assignees} />
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
              <button type="button" className={`rec-stat-btn attention ${stateFilter === "parada" ? "on" : ""}`} onClick={() => toggleStateFilter("parada")} aria-pressed={stateFilter === "parada"}>
                <strong>{stats.paradas}</strong><span>Paradas</span>
              </button>
            </div>
          ) : null}

          <div className="rec-toolbar">
            <div className="kb-viewtabs" aria-label="Visualização das rotinas">
              <button type="button" className={view === "colunas" ? "on" : ""} onClick={() => setView("colunas")}>Colunas</button>
              <button type="button" className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
              <button type="button" className={view === "calendario" ? "on" : ""} onClick={() => setView("calendario")}>Calendário</button>
            </div>
            <RecurringSearchBar query={query} onQueryChange={setQuery} filters={filters} onFiltersChange={setFilters} tasks={rows} onPick={setSelected} />
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
            {/* O calendário é posicionado por data; ordenar ali não significa nada. */}
            {view !== "calendario" ? <SortMenu sort={sort} onChange={setSort} /> : null}
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

          {dndError ? <p className="rec-dnd-error" role="alert">{dndError}</p> : null}

          {!filtered.length ? <div className="rec-empty"><strong>Nenhuma rotina encontrada.</strong><span>Ajuste os filtros para voltar a exibir as rotinas.</span></div> : null}

          {filtered.length && view === "colunas" ? (
            <div className="rec-board" ref={boardRef}>
              {columns.map((column) => (
                <section
                  className={`rec-column${columnDropEnabled && dropTarget === column.key ? " dropping" : ""}`}
                  key={column.key}
                  onDragOver={columnDropEnabled ? (e) => { allowDrop(e); setDropTarget(column.key); } : undefined}
                  onDragLeave={columnDropEnabled ? () => setDropTarget((k) => (k === column.key ? null : k)) : undefined}
                  onDrop={columnDropEnabled ? (e) => { e.preventDefault(); void dropInColumn(column.key); } : undefined}
                >
                  <header>
                    <span className="rec-client-avatar">{column.label.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{column.label}</strong><span>{column.tasks.length} {column.tasks.length === 1 ? "rotina" : "rotinas"}</span></div>
                  </header>
                  <div className="rec-column-stack">
                    {column.tasks.map((task) => (
                      <RecurrenceCard
                        task={task}
                        today={today}
                        onOpen={() => setSelected(task)}
                        onComplete={task.active ? () => void completeCycle(task) : undefined}
                        dragging={dragId === task.id}
                        onDragStart={(e) => onCardDragStart(e, task.id)}
                        onDragEnd={onCardDragEnd}
                        onDropBefore={reorderEnabled ? () => void reorderBefore(task.id) : undefined}
                        key={`${column.key}-${task.id}`}
                      />
                    ))}
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
                const period = formatPeriod(task.start_date, task.end_date);
                return (
                  <div
                    className={`rec-list-row-wrap${dragId === task.id ? " dragging" : ""}`}
                    key={task.id}
                    draggable
                    onDragStart={(e) => onCardDragStart(e, task.id)}
                    onDragEnd={onCardDragEnd}
                    onDragOver={reorderEnabled ? (e) => { allowDrop(e); setDropTarget(task.id); } : undefined}
                    onDragLeave={reorderEnabled ? () => setDropTarget((k) => (k === task.id ? null : k)) : undefined}
                    onDrop={reorderEnabled ? (e) => { e.preventDefault(); void reorderBefore(task.id); } : undefined}
                    data-dropping={reorderEnabled && dropTarget === task.id ? "true" : undefined}
                  >
                    <button type="button" className="rec-list-row" onClick={() => setSelected(task)}>
                    <span className="rec-list-title">
                      <TaskKindIcon kind={task.kind} />
                      <span><strong>{task.title}</strong></span>
                    </span>
                    <span>{task.clientName}</span>
                    <span>{CADENCE_LABEL[task.cadence]}</span>
                    <span className={`rec-list-due ${RECURRING_STATE_TONE[state]}`}>
                      {formatShortDate(task.next_due_date)}
                      {period ? <small className="rec-list-period">{period}</small> : null}
                    </span>
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
                    <div
                      className={`rec-calendar-day ${date ? "" : "empty"} ${key === today ? "is-today" : ""} ${key && dropTarget === key ? "dropping" : ""}`}
                      key={key ?? `empty-${index}`}
                      onDragOver={key ? (e) => { allowDrop(e); setDropTarget(key); } : undefined}
                      onDragLeave={key ? () => setDropTarget((k) => (k === key ? null : k)) : undefined}
                      onDrop={key ? (e) => { e.preventDefault(); void dropOnDay(key); } : undefined}
                    >
                      {date ? (
                        <>
                          <time>{date.getDate()}</time>
                          {dayTasks.map((task) => (
                            <RecurrenceCard
                              task={task}
                              today={today}
                              compact
                              onOpen={() => setSelected(task)}
                              dragging={dragId === task.id}
                              onDragStart={(e) => onCardDragStart(e, task.id)}
                              onDragEnd={onCardDragEnd}
                              key={`${key}-${task.id}`}
                            />
                          ))}
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
