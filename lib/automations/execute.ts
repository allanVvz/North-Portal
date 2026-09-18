// Automação 1 (relatorio_trafego_semanal) v2 — reacts to the admin-picked
// target card's own due date instead of self-managing a synthetic card per
// client (see docs/reporting/report-pipeline.md; the three
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

import { TASK_COLUMNS } from "@/lib/taskColumns";
import type { TaskRecord } from "@/lib/validation";
import { nextRecurringDueDate, recurringExecutionFields, recurringExecutionId } from "@/lib/recurrence";
import { recurrenceCycleOf, recurrenceParentPayload, recurrenceRevisionOf } from "@/lib/recurrenceState";
import { DEFERRED_TASK_FLAG } from "@/lib/taskRelations";
import { publishedWorkflowForKind } from "@/lib/workflows";
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
  // single cron tick; `automation_runs` prevents the same action from
  // succeeding twice. A contains()-style guard
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

// Fluxo de feedback DINÂMICO: a Automação 1 materializa a OCORRÊNCIA do ciclo
// atual e a transforma em Entrega com versão fixada. As etapas (tráfego,
// feedback) são criadas pelas automações via `ensureFlowStep`, não por um
// task_type. Modelo LAZY — id determinístico por ciclo; o avanço do molde fica
// em `advanceFlowMold`, chamado só depois do fill dar certo.
export async function ensureFlowOccurrence(admin: AdminClient, mold: TaskRecord, today: string): Promise<TaskRecord> {
  // Ciclo SEGUINTE ao do molde — a mesma convenção de materializeOccurrenceForReport.
  // Com o ciclo atual, o primeiro tique em modo fluxo achava a ocorrência que o
  // modo normal já tinha criado na semana anterior (mesmo id) e reaproveitava
  // aquele card velho como pai do fluxo desta semana. advanceFlowMold leva o
  // molde a este mesmo ciclo, então um retry no mesmo dia acha a ocorrência.
  const cycle = recurrenceCycleOf(mold) + 1;
  const occId = recurringExecutionId(mold.id, cycle);

  const found = await getAdminTask(admin, occId);
  if (found) return found;

  const workflow = await publishedWorkflowForKind(admin, "automacao");
  if (!workflow?.steps.length) throw new Error("O workflow publicado de Automação não está configurado.");

  const fields = recurringExecutionFields(mold, occId, today, cycle);
  const payload = { ...((fields.payload ?? {}) as Record<string, unknown>) };
  delete payload[DEFERRED_TASK_FLAG];
  payload.automation_actor = AUTOMATION_ASSIGNEE;

  const { data, error } = await admin
    .from("tasks")
    .insert({
      ...fields,
      kind: "automacao",
      subtype: null,
      task_type_id: workflow.delivery_type_id,
      workflow_version_id: workflow.id,
      workflow_activated_at: null,
      payload,
      status: "backlog",
      assignee: AUTOMATION_ASSIGNEE,
    })
    .select(TASK_COLUMNS)
    .limit(1);
  if (error && (error as { code?: string }).code !== "23505") throw error;
  const occurrence = data?.[0] ? asTaskRecord(data[0]) : await getAdminTask(admin, occId);
  if (!occurrence) throw new Error("Não foi possível materializar a ocorrência do fluxo de relatório.");
  return occurrence;
}

// Avança o MOLDE recorrente do fluxo (due_date → próximo ciclo, cycle+1) —
// mesma matemática de completeTaskCycleForRequest / materializeOccurrenceForReport,
// nunca reimplementada. Chamado por run.ts SÓ após o fill da etapa dar certo,
// para uma falha não pular um ciclo. Devolve o molde já atualizado — quem chama
// usa o novo `recurrence_cycle` pra pré-criar o contêiner do ciclo seguinte
// (ver ensureFlowOccurrence em run.ts), sem precisar buscar de novo.
export async function advanceFlowMold(admin: AdminClient, mold: TaskRecord, today: string): Promise<TaskRecord> {
  const nextCycle = recurrenceCycleOf(mold) + 1;
  const revision = recurrenceRevisionOf(mold);
  const nextDue = nextRecurringDueDate(mold.due_date ?? today, {
    cadence: mold.recurrence_cadence!,
    weekdays: mold.recurrence_weekdays,
    dayOfMonth: mold.recurrence_day_of_month,
    startDate: mold.start_date ?? mold.due_date,
  });
  // Compare-and-set no vencimento que esta chamada leu: duas conclusões
  // simultâneas da mesma Entrega (ou um retry) avançam o molde UMA vez. Sem o
  // filtro, a segunda relia o molde já avançado e pulava um ciclo inteiro.
  let update = admin
    .from("tasks")
    .update({
      due_date: nextDue,
      end_date: !mold.end_date || nextDue > mold.end_date ? nextDue : mold.end_date,
      payload: recurrenceParentPayload(mold.payload, nextCycle, revision),
    })
    .eq("id", mold.id);
  update = mold.due_date ? update.eq("due_date", mold.due_date) : update.is("due_date", null);
  const { data, error } = await update.select(TASK_COLUMNS).limit(1);
  if (error) throw error;
  if (data?.[0]) return asTaskRecord(data[0]);
  // Outro caminho avançou primeiro: devolve o molde como ele está agora.
  return (await getAdminTask(admin, mold.id)) ?? mold;
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
