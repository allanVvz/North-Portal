import type { RecurrenceRule } from "./recurrence";
import type { TaskRecord } from "./validation";
import { ACTION_PLAN_PAYLOAD_KEY } from "./taskRelations";

export const EXPLICIT_DATES_KEY = "explicit_occurrence_dates";
export const EXPLICIT_GROUP_KEY = "explicit_date_group_id";
const EXECUTION_LOCAL_PAYLOAD_KEYS = [EXPLICIT_GROUP_KEY, "occurrence_date", "deferred_until_accessed", "accessed_at", ACTION_PLAN_PAYLOAD_KEY] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeOccurrenceDates(value: unknown, fallback?: string | null): string[] {
  const source = Array.isArray(value) ? value : [];
  const dates = source.filter((item): item is string => typeof item === "string" && isRealDate(item));
  if (fallback && isRealDate(fallback)) dates.push(fallback);
  return [...new Set(dates)].sort().slice(0, 31);
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;
}

/** Infer a readable cadence while the explicit dates remain the source of truth. */
export function inferDateGroupRule(dates: string[]): RecurrenceRule {
  const normalized = normalizeOccurrenceDates(dates);
  const parsed = normalized.map((value) => new Date(`${value}T12:00:00Z`));
  const sameMonthDay = parsed.length > 1 && parsed.every((date) => date.getUTCDate() === parsed[0].getUTCDate());
  if (sameMonthDay && parsed.some((date) => date.getUTCMonth() !== parsed[0].getUTCMonth())) {
    return { cadence: "mensal", weekdays: [], dayOfMonth: parsed[0].getUTCDate() };
  }
  const fortnightly = normalized.length > 1 && normalized.slice(1).every((date, index) => daysBetween(normalized[index], date) === 14);
  if (fortnightly) return { cadence: "quinzenal", weekdays: [], dayOfMonth: null };
  return { cadence: "semanal", weekdays: [...new Set(parsed.map((date) => date.getUTCDay()))].sort(), dayOfMonth: null };
}

export function explicitDatesOf(task: Pick<TaskRecord, "payload" | "due_date">): string[] {
  return normalizeOccurrenceDates(task.payload?.[EXPLICIT_DATES_KEY], task.due_date);
}

export function nextExplicitOccurrenceDate(dates: string[], current: string): string | null {
  return normalizeOccurrenceDates(dates).find((date) => date > current) ?? null;
}

export function isExplicitDateParent(task: Pick<TaskRecord, "payload" | "due_date" | "recurrence_cadence">): boolean {
  return Boolean(task.recurrence_cadence) && explicitDatesOf(task).length > 1;
}

const REPLICA_KEYS = new Set([
  "title", "kind", "subtype", "status", "priority", "assignee", "reviewer_id", "approver_id",
  "requires_review", "requires_approval", "progress_weight", "description", "client_visible", "payload", "client_id",
]);

/** Dates and relationship identity never fan out; all user-facing content does. */
export function replicaPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => REPLICA_KEYS.has(key)));
}

const PARENT_TEMPLATE_KEYS = new Set([
  "title", "kind", "subtype", "priority", "assignee", "reviewer_id", "approver_id", "requires_review",
  "requires_approval", "progress_weight", "description", "client_visible", "client_id",
]);

export function parentTemplatePatch(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => PARENT_TEMPLATE_KEYS.has(key)));
}

/** Replicate user-facing payload fields without overwriting the lifecycle
 * metadata that belongs to each individual execution. */
export function replicatedExecutionPayload(
  source: Record<string, unknown>,
  target: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...source };
  delete next[EXPLICIT_DATES_KEY];
  for (const key of EXECUTION_LOCAL_PAYLOAD_KEYS) {
    if (target && key in target) next[key] = target[key];
    else delete next[key];
  }
  return next;
}
