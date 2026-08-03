import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteTask, getClient, getClientFlowFlags, getTaskById, updateTaskGroup } from "@/lib/supabase";
import { EXPLICIT_DATES_KEY, inferDateGroupRule, normalizeOccurrenceDates } from "@/lib/taskDateGrouping";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, canLeaveRevisao, introducesInvalidPublishedState, requiresManagerApproval, taskPatchSchema } from "@/lib/validation";

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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const { slug, ...patch } = taskPatchSchema.parse(await request.json());

    const current = await getTaskById(id);
    if (!current) throw new HttpError(404, "Tarefa nao encontrada.");
    const explicitDates = normalizeOccurrenceDates(patch.payload?.[EXPLICIT_DATES_KEY]);
    if (!current.plan_id && explicitDates.length > 1) {
      const rule = inferDateGroupRule(explicitDates);
      patch.due_date = explicitDates[0];
      patch.start_date = explicitDates[0];
      patch.recurrence_cadence = rule.cadence;
      patch.recurrence_weekdays = rule.weekdays;
      patch.recurrence_day_of_month = rule.dayOfMonth;
      patch.plan_id = null;
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
    if ((patch.kind ?? current.kind) === "plano_acao" && nextRecurrence) {
      throw new HttpError(400, "Plano de Acao e um tipo unico e nao pode ser recorrente.");
    }

    // Only gerente-level admins decide the approval gate either way — approve
    // (aprovado) or reopen a resolved card back to aprovacao — enforced here
    // so it holds regardless of surface (Kanban drag, TaskModal, Aprovações).
    // Every other transition (including moving a card OUT of aprovacao to
    // anything other than aprovado) is unrestricted.
    if (requiresManagerApproval(current.status, patch.status) && session.level !== "gerente") {
      throw new HttpError(403, "Apenas gerentes podem aprovar ou reabrir um card.");
    }

    // Only the reviewer assigned on the card can move it out of Revisão —
    // internal review is never a free-for-all across the whole admin team.
    // An unclaimed card (no reviewer yet) has no exclusive owner to protect,
    // so it doesn't lock everyone out.
    if (patch.status && patch.status !== "revisao" && !canLeaveRevisao(current.status, current.reviewer_id, session.userId)) {
      throw new HttpError(403, "Apenas o revisor designado pode mover este card para fora da Revisão.");
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

    const task = await updateTaskGroup(id, current, patch);
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
