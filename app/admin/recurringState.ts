import type { RecurringTask } from "@/lib/supabase";

// Single source of truth for "what state is this routine in right now".
//
// Before this module the answer was spread across three functions in
// ClientsWorkspace.tsx that disagreed with each other: the badge knew four
// states, the filter knew two, and the stats counted a fifth thing. Worse, the
// only "completed" signal read was `template_payload.cycle_completed`, which
// ONLY the Trello importer writes — a native routine could rack up
// `completed_cycles` and never once read as concluded.
//
// The two sources also disagree about `active`: lib/trello.ts sets
// `active: Boolean(card.due)` (meaning "has no date"), while a native row uses
// it for "paused by an admin". No vocabulary can honour both, so both collapse
// into `sem_agenda` — the one label that is true either way.

export type RecurringState = "atrasada" | "ativa" | "concluida" | "sem_agenda";

export const RECURRING_STATE_LABEL: Record<RecurringState, string> = {
  atrasada: "Atrasada",
  ativa: "Ativa",
  concluida: "Ciclo concluído",
  sem_agenda: "Sem agenda",
};

/** Matches the `.rec-state.*` / `.rec-pulse-fill.*` tones in globals.css. */
export const RECURRING_STATE_TONE: Record<RecurringState, string> = {
  atrasada: "overdue",
  ativa: "active",
  concluida: "complete",
  sem_agenda: "paused",
};

export const RECURRING_STATES = ["atrasada", "ativa", "concluida", "sem_agenda"] as const;

type StateInput = Pick<
  RecurringTask,
  "active" | "cadence" | "weekdays" | "next_due_date" | "last_completed_at" | "timezone" | "template_payload"
>;

/**
 * "Today" as YYYY-MM-DD in the routine's own timezone.
 *
 * Not `new Date()`: the server runs in UTC, so from 21:00 BRT onwards a routine
 * due today would already compare as overdue — the app flagged routines three
 * hours early every single evening.
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we compare on.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  }
}

/** Nominal days between two runs — semanal[seg,qui] is 3, not 7. */
export function cycleLengthDays(task: Pick<StateInput, "cadence" | "weekdays">): number {
  if (task.cadence === "mensal") return 30;
  if (task.cadence === "quinzenal") return 14;
  const days = [...new Set(task.weekdays)].sort((a, b) => a - b);
  if (days.length < 2) return 7;
  const gaps = days.map((day, index) => (index === 0 ? day + 7 - days[days.length - 1] : day - days[index - 1]));
  return Math.min(...gaps);
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function recurringState(task: StateInput, today?: string): RecurringState {
  if (!task.active || !task.next_due_date) return "sem_agenda";

  // Trello's own "due complete" checkbox — a persistent flag on the card.
  if (task.template_payload?.cycle_completed === true) return "concluida";

  // Native rows: completing a cycle pushes next_due_date into the future and
  // stamps last_completed_at, so "was it completed within the current cycle
  // window" is what distinguishes "done for now" from "coming up". It rolls
  // back to `ativa` on its own once the window turns over.
  if (task.last_completed_at) {
    const completedOn = task.last_completed_at.slice(0, 10);
    if (completedOn >= addDays(task.next_due_date, -cycleLengthDays(task))) return "concluida";
  }

  const reference = today ?? todayInTimezone(task.timezone);
  return task.next_due_date < reference ? "atrasada" : "ativa";
}
