// Automação 1 (relatorio_trafego_semanal) v2 — reacts to the admin-picked
// target card's own due date instead of self-managing a synthetic card per
// client (see plan/AUTOMACOES-RELATORIO-TRAFEGO.md "Automação 1 — 3
// comportamentos por formato do card"). Branches by the target card's shape:
//   - task comum: fills the card itself in place.
//   - card recorrente: materializes a fresh occurrence each cycle (same
//     recurrence math completeTaskCycleForRequest uses, lib/supabase.ts —
//     never reimplemented here) and fills that.
//   - plano de ação: clones the whole plan (lib/automations/provision.ts's
//     clonePlan) into a new instance and fills its parent.
// Only "which card gets a new row created, if any" lives here — actually
// fetching data / rendering the PDF / attaching the document is
// lib/automations/run.ts's job, kept separate so this file stays pure
// card-shape branching.

import { TASK_COLUMNS } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";
import { nextRecurringDueDate, recurringExecutionFields, recurringExecutionId } from "@/lib/recurrence";
import { recurrenceCycleOf, recurrenceParentPayload, recurrenceRevisionOf } from "@/lib/recurrenceState";
import { clonePlan } from "./provision";
import { asTaskRecord, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";

// Advances the recurring parent forward (due_date → next occurrence, cycle+1)
// exactly like completeTaskCycleForRequest, then materializes a fresh child
// dated *today* (the occurrence that just became due) rather than the
// parent's new due_date — this child is the one-off "deliver today's report"
// card, distinct from the app's normal "child mirrors the parent's next due
// date" convention, because here the automation itself is the sole driver of
// the cycle, not a human working the card in between.
export async function materializeOccurrenceForReport(admin: AdminClient, parent: TaskRecord, today: string): Promise<TaskRecord> {
  const currentCycle = recurrenceCycleOf(parent);
  const currentRevision = recurrenceRevisionOf(parent);
  const nextCycle = currentCycle + 1;
  const nextDue = nextRecurringDueDate(parent.due_date ?? today, {
    cadence: parent.recurrence_cadence!,
    weekdays: parent.recurrence_weekdays,
    dayOfMonth: parent.recurrence_day_of_month,
    startDate: parent.start_date ?? parent.due_date,
  });

  const executionId = recurringExecutionId(parent.id, nextCycle);
  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({ ...recurringExecutionFields(parent, executionId, today, nextCycle), assignee: AUTOMATION_ASSIGNEE })
    .select(TASK_COLUMNS)
    .limit(1);
  if (insertError && (insertError as { code?: string }).code !== "23505") throw insertError;
  let execution = inserted?.[0] ? asTaskRecord(inserted[0]) : null;
  if (!execution) execution = await getAdminTask(admin, executionId);
  if (!execution) throw new Error("Não foi possível materializar a execução do relatório.");

  // Advance the parent so the next check (tomorrow, or whenever nextDue
  // arrives) finds the right date. No optimistic-concurrency guard here
  // (unlike completeTaskCycleForRequest, which faces concurrent human
  // clicks) — this automation is the sole writer of a given parent within a
  // single cron tick, and automation_configs.last_run_date already prevents
  // the same config from running twice in one day. A contains()-style guard
  // keyed on the *current* cycle/revision would also silently no-op for any
  // parent whose payload doesn't literally carry those keys yet (e.g. cycle
  // 0 with no prior completed cycle) — real recurring tasks always get them
  // via recurrenceParentPayload() at creation, but that's a fragility this
  // automation doesn't need to inherit.
  const { error: advanceError } = await admin
    .from("tasks")
    .update({
      due_date: nextDue,
      end_date: !parent.end_date || nextDue > parent.end_date ? nextDue : parent.end_date,
      payload: recurrenceParentPayload(parent.payload, nextCycle, currentRevision),
    })
    .eq("id", parent.id);
  if (advanceError) throw advanceError;

  return execution;
}

// Plano de ação branch: clone the whole structure into a fresh instance
// (same client) via the exact mechanism Automação 2 already uses, then — if
// the plan-template itself is also recurring — advance its own due date
// forward (no child row for a plan; the clone itself IS the next occurrence).
export async function clonePlanForReport(admin: AdminClient, planTemplate: TaskRecord, today: string): Promise<TaskRecord> {
  const clone = await clonePlan(admin, planTemplate, planTemplate.client_id as string);

  if (planTemplate.recurrence_cadence) {
    const currentCycle = recurrenceCycleOf(planTemplate);
    const currentRevision = recurrenceRevisionOf(planTemplate);
    const nextCycle = currentCycle + 1;
    const nextDue = nextRecurringDueDate(planTemplate.due_date ?? today, {
      cadence: planTemplate.recurrence_cadence,
      weekdays: planTemplate.recurrence_weekdays,
      dayOfMonth: planTemplate.recurrence_day_of_month,
      startDate: planTemplate.start_date ?? planTemplate.due_date,
    });
    const { error: advanceError } = await admin
      .from("tasks")
      .update({
        due_date: nextDue,
        end_date: !planTemplate.end_date || nextDue > planTemplate.end_date ? nextDue : planTemplate.end_date,
        payload: recurrenceParentPayload(planTemplate.payload, nextCycle, currentRevision),
      })
      .eq("id", planTemplate.id);
    if (advanceError) throw advanceError;
  }

  return clone;
}
