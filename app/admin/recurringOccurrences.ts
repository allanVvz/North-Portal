import type { RecurringTask } from "@/lib/supabase";

// Expands a routine into the dates it actually runs inside a window.
//
// The calendar used to place each routine on `next_due_date` alone, so a weekly
// routine showed up once a month — the one view where recurrence is the whole
// point was the one view that ignored it.
//
// All arithmetic runs on UTC-noon epoch days: parsing "2026-07-21" as local
// midnight and adding days drifts across DST boundaries, and noon leaves 12h of
// slack on either side so it never can.

type OccurrenceInput = Pick<RecurringTask, "cadence" | "weekdays" | "day_of_month" | "next_due_date" | "active">;

const DAY_MS = 86_400_000;

function toEpochDay(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 12) / DAY_MS);
}

function toIso(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

function dayOfWeek(epochDay: number): number {
  return new Date(epochDay * DAY_MS).getUTCDay();
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Positive modulo — the anchor can sit after rangeStart, so `%` alone is wrong. */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Every date the routine runs within [rangeStart, rangeEnd], sorted and unique.
 * Projects both backwards and forwards from `next_due_date`, so a month view is
 * complete even when the anchor sits past the end of the visible range.
 */
export function recurringOccurrences(
  task: OccurrenceInput,
  rangeStart: string,
  rangeEnd: string,
  options: { maxOccurrences?: number; maxDays?: number } = {},
): string[] {
  if (!task.active || !task.next_due_date) return [];

  const maxOccurrences = options.maxOccurrences ?? 120;
  const maxDays = options.maxDays ?? 400;

  const anchor = toEpochDay(task.next_due_date);
  const start = toEpochDay(rangeStart);
  const end = Math.min(toEpochDay(rangeEnd), start + maxDays);
  if (end < start) return [];

  const out: string[] = [];

  if (task.cadence === "mensal") {
    const day = task.day_of_month ?? new Date(anchor * DAY_MS).getUTCDate();
    const first = new Date(start * DAY_MS);
    // Start a month early so an occurrence clamped backwards still lands in range.
    let year = first.getUTCFullYear();
    let monthIndex = first.getUTCMonth() - 1;
    for (let step = 0; step < 15 && out.length < maxOccurrences; step += 1) {
      const cursor = new Date(Date.UTC(year, monthIndex, 1));
      const cursorYear = cursor.getUTCFullYear();
      const cursorMonth = cursor.getUTCMonth();
      const occurrence = toEpochDay(
        `${cursorYear}-${String(cursorMonth + 1).padStart(2, "0")}-${String(Math.min(day, daysInMonth(cursorYear, cursorMonth))).padStart(2, "0")}`,
      );
      if (occurrence > end) break;
      if (occurrence >= start) out.push(toIso(occurrence));
      monthIndex += 1;
      if (monthIndex > 11) {
        monthIndex = 0;
        year += 1;
      }
    }
    return out;
  }

  const weekdays = task.cadence === "semanal" ? [...new Set(task.weekdays)] : [];
  const period = task.cadence === "quinzenal" ? 14 : 7;

  for (let day = start; day <= end && out.length < maxOccurrences; day += 1) {
    const matches = weekdays.length
      ? weekdays.includes(dayOfWeek(day))
      : mod(day - anchor, period) === 0;
    if (matches) out.push(toIso(day));
  }
  return out;
}
