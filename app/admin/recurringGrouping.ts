import type { RecurringTask } from "@/lib/supabase";
import { recurringAssignees } from "./recurringTaskFilters";
import { recurringState } from "./recurringState";

// Column buckets for the Recorrências board, plus the one ordering every view
// shares.
//
// The board used to draw one column per client, which meant 11 columns of
// 240px on a screen that fits four — and it stopped making sense entirely once
// Cliente became a filter chip. Grouping by deadline answers the question the
// team actually opens this screen with: what is late, and what is due this week.

export type RecurringGroupBy = "prazo" | "cliente" | "responsavel";

export const RECURRING_GROUP_BY_LABEL: Record<RecurringGroupBy, string> = {
  prazo: "Prazo",
  cliente: "Cliente",
  responsavel: "Responsável",
};

export type RecurringGroup = { key: string; label: string; tasks: RecurringTask[] };

const SEM_RESPONSAVEL = "Sem responsável";
const SEM_AGENDA = "Sem agenda";

const PRAZO_BUCKETS = [
  { key: "paradas", label: "Paradas" },
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mês" },
  { key: "depois", label: "Depois" },
  { key: "concluidas", label: "Ciclo concluído" },
  { key: "sem_agenda", label: SEM_AGENDA },
] as const;

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function prazoBucket(task: RecurringTask, today: string): string {
  // The state decides first, so the columns can never disagree with the badge
  // on the card or with the counters above them. A routine whose cycle is
  // already closed is finished work, not something overdue to chase.
  const state = recurringState(task, today);
  if (state === "sem_agenda" || !task.next_due_date) return "sem_agenda";
  if (state === "concluida") return "concluidas";
  if (task.next_due_date < today) return "paradas";
  if (task.next_due_date <= addDays(today, 7)) return "semana";
  if (task.next_due_date <= addDays(today, 30)) return "mes";
  return "depois";
}

/**
 * Overdue first, then soonest due date, then most recently updated. Nulls
 * sort last — a routine with no date is never the most urgent thing on the
 * board.
 */
export function compareByUrgency(a: RecurringTask, b: RecurringTask): number {
  if (a.next_due_date !== b.next_due_date) {
    if (!a.next_due_date) return 1;
    if (!b.next_due_date) return -1;
    return a.next_due_date < b.next_due_date ? -1 : 1;
  }
  return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
}

/**
 * `sort` recebe a lista inteira (e não um comparador) porque a ordenação da
 * tela não é expressável como comparação par a par: "sem data sempre por
 * último, nas duas direções" e a estabilidade do empate dependem de conhecer o
 * conjunto — ver taskSort.ts:sortItems. É opcional de propósito: sem ele o
 * quadro mantém exatamente o comportamento histórico (urgência).
 */
export function groupRecurring(
  tasks: RecurringTask[],
  groupBy: RecurringGroupBy,
  today: string,
  sort: (tasks: RecurringTask[]) => RecurringTask[] = (items) => [...items].sort(compareByUrgency),
): RecurringGroup[] {
  const sorted = sort(tasks);

  if (groupBy === "prazo") {
    return PRAZO_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      tasks: sorted.filter((task) => prazoBucket(task, today) === bucket.key),
    })).filter((group) => group.tasks.length > 0);
  }

  const buckets = new Map<string, RecurringGroup>();
  for (const task of sorted) {
    // A card shared by two people belongs in both columns, the same way it
    // matches either name in the Responsável filter.
    const keys =
      groupBy === "cliente"
        ? [task.clientName]
        : recurringAssignees(task).length
          ? recurringAssignees(task)
          : [SEM_RESPONSAVEL];
    for (const key of keys) {
      const group = buckets.get(key);
      if (group) group.tasks.push(task);
      else buckets.set(key, { key, label: key, tasks: [task] });
    }
  }

  return [...buckets.values()].sort((a, b) => {
    if (a.key === SEM_RESPONSAVEL) return 1;
    if (b.key === SEM_RESPONSAVEL) return -1;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}
