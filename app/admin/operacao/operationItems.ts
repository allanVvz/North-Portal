import { kindLabel, subtypeLabel } from "@/lib/taskCatalog";
import { belongsToTaskScreen, isDeferredTask, recurrenceParentIdOf } from "@/lib/taskRelations";
import type { RecurringTask } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";
import { deadlineStateOf } from "../deadlineState";
import { recurringState } from "../recurringState";

export type OperationTask = TaskRecord & { clientName?: string; clientSlug?: string };
export type OperationItem = {
  id: string;
  task: OperationTask | RecurringTask;
  clientName: string;
  clientSlug: string;
  routine: boolean;
};

export type OperationFilterAttr = "tipo" | "subtipo" | "situacao" | "cliente" | "frequencia" | "prioridade" | "responsavel";
export type OperationFilter = { attr: OperationFilterAttr; value: string; label: string };

/**
 * The daily surface has exactly two identities: an ordinary executable card,
 * or a recurrence template.  Executions are evidence inside their template;
 * they must never leak back as a second top-level card.
 */
export function normalizeOperationItems(tasks: readonly OperationTask[], routines: readonly RecurringTask[]): OperationItem[] {
  const seen = new Set<string>();
  const templateIds = new Set(routines.map((routine) => routine.id));
  const executionIds = new Set(routines.flatMap((routine) => routine.executions.map((execution) => execution.id)));
  const output: OperationItem[] = [];
  for (const task of tasks) {
    // Some legacy tasks still have plan_id for an Action Plan. An execution is
    // identified by its recurrence payload (or by the children returned with
    // a visible routine), never by plan_id alone.
    if (!belongsToTaskScreen(task) || recurrenceParentIdOf(task) || templateIds.has(task.plan_id ?? "") || executionIds.has(task.id)) continue;
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    output.push({ id: task.id, task, clientName: task.clientName ?? "Outros", clientSlug: task.clientSlug ?? "", routine: false });
  }
  for (const task of routines) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    output.push({ id: task.id, task, clientName: task.clientName, clientSlug: task.clientSlug, routine: true });
  }
  return output;
}

export function itemTypeTags(item: OperationItem): string[] {
  return item.routine ? [item.task.kind, "rotina"] : [item.task.kind];
}

export function itemTypeLabels(item: OperationItem): string[] {
  return [...itemTypeTags(item).map((tag) => tag === "rotina" ? "Rotina" : kindLabel(tag))];
}

export function compatibleSubtypes(items: readonly OperationItem[], selectedTypes: readonly string[]): string[] {
  return [...new Set(items
    .filter((item) => selectedTypes.every((tag) => itemTypeTags(item).includes(tag)))
    .map((item) => item.task.subtype)
    .filter((value): value is string => Boolean(value)))]
    .sort((a, b) => subtypeLabel(a).localeCompare(subtypeLabel(b), "pt-BR"));
}

function assignees(item: OperationItem): string[] {
  return (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean);
}

export function operationSituation(item: OperationItem, today: string): string {
  if (item.routine) {
    const routine = item.task as RecurringTask;
    return recurringState(routine, today);
  }
  return deadlineStateOf(item.task, today);
}

/** Different attributes AND together. Multiple Tipo chips also AND together,
 * which is what makes `Rotina` + `Automação` a precise intersection. */
export function operationMatchesFilters(item: OperationItem, filters: readonly OperationFilter[], today: string): boolean {
  return filters.every((filter) => {
    if (filter.attr === "tipo") return itemTypeTags(item).includes(filter.value);
    if (filter.attr === "subtipo") return item.task.subtype === filter.value;
    if (filter.attr === "situacao") return operationSituation(item, today) === filter.value;
    if (filter.attr === "cliente") return item.clientName === filter.value;
    if (filter.attr === "frequencia") return item.routine && (item.task as RecurringTask).cadence === filter.value;
    if (filter.attr === "prioridade") return item.task.priority === filter.value;
    const names = assignees(item);
    return filter.value === "Sem responsável" ? names.length === 0 : names.includes(filter.value);
  });
}

export type RoutineCalendarEvent = { id: string; date: string; routine: RecurringTask; execution: TaskRecord };

/** Date precedence is factual: an explicit scheduled timestamp, then the
 * persisted occurrence date, finally the task due date. */
export function factualDateOf(task: Pick<TaskRecord, "scheduled_start_at" | "payload" | "due_date">): string | null {
  if (task.scheduled_start_at) {
    const parsed = new Date(task.scheduled_start_at);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
      const value = (type: string) => parts.find((part) => part.type === type)?.value;
      const year = value("year"); const month = value("month"); const day = value("day");
      if (year && month && day) return `${year}-${month}-${day}`;
    }
  }
  const occurrence = task.payload?.occurrence_date;
  if (typeof occurrence === "string" && /^\d{4}-\d{2}-\d{2}/.test(occurrence)) return occurrence.slice(0, 10);
  return task.due_date?.slice(0, 10) ?? null;
}

/**
 * There is deliberately no cadence expansion here. Completed executions are
 * historical facts; at most one open materialized execution represents now.
 */
export function factualRoutineEvents(routines: readonly RecurringTask[]): RoutineCalendarEvent[] {
  const events: RoutineCalendarEvent[] = [];
  for (const routine of routines) {
    // The API has already joined these child rows to their template. Legacy
    // explicit children do not always mirror that relation in payload. A
    // deferred row cannot become the present-tense occurrence.
    const materializedOpen = routine.executions.filter((execution) => !execution.completed_at && execution.status !== "aprovado" && execution.status !== "parada" && !isDeferredTask(execution));
    const current = [...materializedOpen].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
    const emitted = new Set<string>();
    for (const execution of routine.executions) {
      if (isDeferredTask(execution)) continue;
      const completed = Boolean(execution.completed_at) || execution.status === "aprovado";
      const isCurrent = current?.id === execution.id;
      if (!completed && (!isCurrent || isDeferredTask(execution))) continue;
      const date = factualDateOf(execution);
      if (date && !emitted.has(execution.id)) { emitted.add(execution.id); events.push({ id: `${routine.id}:${execution.id}`, date, routine, execution }); }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.routine.title.localeCompare(b.routine.title, "pt-BR"));
}
