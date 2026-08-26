import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteTask, getClient, getClientFlowFlags, getTaskById, setTaskAssigneeProfiles, updateTaskGroup, updateTaskPayloadPatch } from "@/lib/supabase";
import { EXPLICIT_DATES_KEY, inferDateGroupRule, normalizeOccurrenceDates } from "@/lib/taskDateGrouping";
import { recurrenceParentIdOf, recurringActionPlanPatch } from "@/lib/taskRelations";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyTaskParticipants, statusChangedMessage, taskUpdatedMessage } from "@/lib/notifications";
import { HttpError, introducesInvalidPublishedState, taskPatchSchema, type TaskRecord } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/tasks/[id] — single task, for surfaces (e.g. Plano de Ação's
// strategic view) that only hold a summary shape and need the full record to
// open the editor modal.
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const task = await getTaskById(id);
    if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
    return NextResponse.json(task);
  } catch (error) {
    return apiError(error);
  }
}

// Uma edição gera UMA notificação: mudança de status é o evento que interessa
// quando ela acontece, e as duas juntas encheriam a caixa com o mesmo salvamento.
async function notifyTaskChange(before: TaskRecord, after: TaskRecord): Promise<void> {
  if (before.status !== after.status) {
    await notifyTaskParticipants(after.id, "task_status_changed", statusChangedMessage(after.title, after.status));
    return;
  }
  await notifyTaskParticipants(after.id, "task_updated", taskUpdatedMessage(after.title));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const { slug, assignee_profile_ids, payload_patch, ...patch } = taskPatchSchema.parse(await request.json());

    const current = await getTaskById(id);
    if (!current) throw new HttpError(404, "Tarefa nao encontrada.");
    const explicitDates = normalizeOccurrenceDates(patch.payload?.[EXPLICIT_DATES_KEY]);
    if (!current.recurrence_cadence && !recurrenceParentIdOf(current) && explicitDates.length > 1) {
      const rule = inferDateGroupRule(explicitDates);
      patch.due_date = explicitDates[0];
      patch.start_date = explicitDates[0];
      patch.recurrence_cadence = rule.cadence;
      patch.recurrence_weekdays = rule.weekdays;
      patch.recurrence_day_of_month = rule.dayOfMonth;
      patch.end_date = explicitDates.at(-1);
      if (patch.payload) delete patch.payload[EXPLICIT_DATES_KEY];
    }

    // Resolve a client change before anything else — later checks (flow
    // flags) must see the DESTINATION client, not the one being left.
    let nextClientId = current.client_id;
    if (slug !== undefined) {
      const client = slug ? await getClient(slug, true) : null;
      if (slug && !client) throw new HttpError(404, "Cliente nao encontrado.");
      nextClientId = client?.id ?? null;
      (patch as Record<string, unknown>).client_id = nextClientId;
    }

    // "Publicado" (concluido) is Criativo-only — the correlation with a real
    // publication (payload.metaPostId) and the metrics it then accumulates
    // only make sense for that kind.
    if (introducesInvalidPublishedState(current, patch)) {
      throw new HttpError(400, "Apenas cards do tipo Criativo podem ir para Publicado.");
    }
    const nextRecurrence = patch.recurrence_cadence !== undefined ? patch.recurrence_cadence : current.recurrence_cadence;
    if (nextRecurrence) {
      const start = patch.start_date !== undefined ? patch.start_date : current.start_date ?? current.due_date;
      const weekdays = patch.recurrence_weekdays ?? current.recurrence_weekdays;
      if (!start) throw new HttpError(400, "Informe o início da recorrência.");
      if (!weekdays.length) throw new HttpError(400, "Selecione pelo menos um dia da semana.");
      patch.start_date = start;
      patch.recurrence_day_of_month = nextRecurrence === "mensal" ? Number(start.slice(8, 10)) : null;
      const end = patch.end_date !== undefined ? patch.end_date : current.end_date;
      if (!end || end < start) patch.end_date = start;
    }

    // Defense-in-depth: a client with a stage admin-disabled never carries a
    // reviewer/approver, even if a stale client tab (open before the flag
    // flipped) tries to send one back. Unassigned ("Outros") tasks have no
    // client flags to check.
    if (nextClientId) {
      const flags = await getClientFlowFlags(nextClientId);
      if (!flags.revisaoAdmin) {
        patch.reviewer_id = null;
        patch.requires_review = false;
      }
      if (!flags.aprovacaoAdmin) {
        patch.approver_id = null;
        patch.requires_approval = false;
      }
    }

    let task = await updateTaskGroup(id, current, recurringActionPlanPatch(current, patch));
    if (payload_patch) task = await updateTaskPayloadPatch(id, payload_patch);
    if (assignee_profile_ids !== undefined) {
      await setTaskAssigneeProfiles(task.id, assignee_profile_ids);
      const full = await getTaskById(task.id);
      await notifyTaskChange(current, full ?? task);
      return NextResponse.json(full ?? task);
    }
    await notifyTaskChange(current, task);
    return NextResponse.json(task);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
