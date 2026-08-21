// Shared admin-client task read helpers — every automation module runs
// without a session (service-role only), so none of lib/supabase.ts's
// session-scoped getters apply here.

import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/supabase";
import { commentsOf, type TaskComment } from "@/lib/comments";
import type { TaskRecord } from "@/lib/validation";

export type AdminClient = ReturnType<typeof createAdminClient>;

// Product rule (2026-08-21): every card an automation creates, clones, or
// otherwise touches gets this as its Responsável — there's no real profile
// account behind it, just a plain free-text label (same column humans use),
// so the board always shows who/what is driving that card.
export const AUTOMATION_ASSIGNEE = "North ai";

// Rows read via the admin client never carry the task_assignees join
// (mergeTaskAssigneeRow is a session-path concern) — assignee_profile_ids is
// unused by every automation code path, so an empty array is safe here.
export function asTaskRecord(row: Record<string, unknown>): TaskRecord {
  return { ...row, assignee_profile_ids: [] } as unknown as TaskRecord;
}

export async function getAdminTask(admin: AdminClient, id: string): Promise<TaskRecord | null> {
  const { data, error } = await admin.from("tasks").select(TASK_COLUMNS).eq("id", id).limit(1);
  if (error) throw error;
  return data?.[0] ? asTaskRecord(data[0]) : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every automation run — success or failure — leaves exactly one new comment
// from "Automação" per card per run (see memory automations-comment-rule):
// a standard/generic line today, one appended per cycle, never rewriting or
// collapsing prior ones. Shared so run.ts (success) and errorHandling.ts
// (failure) never diverge in how a comment gets appended.
export function appendedCommentPayload(payload: Record<string, unknown> | null | undefined, text: string, author = "Automação"): Record<string, unknown> {
  const comment: TaskComment = { author, text, at: new Date().toISOString() };
  return { ...(payload ?? {}), comments: [...commentsOf(payload), comment].slice(-200) };
}
