import type { RecurringTask } from "@/lib/supabase";
import { kindLabel } from "@/lib/taskCatalog";
import { PRIORITY_LABEL } from "./kanbanShared";
import { RECURRING_STATE_LABEL, recurringState, type RecurringState } from "./recurringState";

export type RecurringFilterAttr = "cliente" | "tipo" | "frequencia" | "prioridade" | "responsavel" | "estado";
export type RecurringActiveFilter = { attr: RecurringFilterAttr; value: string; label: string };

const SEM_RESPONSAVEL = "Sem responsável";

/**
 * The people on a routine. Trello joins card members into one string
 * ("Ana, Bruno"), so filtering by a person has to look inside it — otherwise
 * picking "Ana" silently misses every card she shares with someone.
 */
export function recurringAssignees(task: Pick<RecurringTask, "assignee">): string[] {
  return (task.assignee ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function recurringAssigneeOptions(tasks: Pick<RecurringTask, "assignee">[]): string[] {
  const names = new Set<string>();
  let hasUnassigned = false;
  for (const task of tasks) {
    const assignees = recurringAssignees(task);
    if (assignees.length) assignees.forEach((name) => names.add(name));
    else hasUnassigned = true;
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return hasUnassigned ? [...sorted, SEM_RESPONSAVEL] : sorted;
}

export function recurringMatchesFilters(task: RecurringTask, filters: RecurringActiveFilter[], today?: string): boolean {
  return filters.every((filter) => {
    if (filter.attr === "cliente") return task.clientName === filter.value;
    if (filter.attr === "tipo") return task.kind === filter.value;
    if (filter.attr === "frequencia") return task.cadence === filter.value;
    if (filter.attr === "prioridade") return task.priority === filter.value;
    if (filter.attr === "estado") return recurringState(task, today) === (filter.value as RecurringState);
    const assignees = recurringAssignees(task);
    return filter.value === SEM_RESPONSAVEL ? assignees.length === 0 : assignees.includes(filter.value);
  });
}

export function recurringSearchText(task: RecurringTask): string {
  return [
    task.title,
    task.description,
    task.clientName,
    kindLabel(task.kind),
    task.cadence,
    task.assignee,
    PRIORITY_LABEL[task.priority],
    RECURRING_STATE_LABEL[recurringState(task)],
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("pt-BR");
}
