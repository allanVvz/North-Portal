import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getProfileName, getTaskById, updateTaskGroup } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { clientApprovalActionSchema, HttpError, validateSlug } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/client/[slug]/tasks/[id] — the client-side "Aprovar entrega" /
// "Solicitar ajustes" action. The APROVADOR registered on the card
// (task.approver_id) may act on it — and so can a 'gerente'-level account of
// that same client, escalating over cards assigned to their 'usuario'
// accounts. Enforced twice: here (for a clean 403) and by the "tasks client
// approve own" RLS policy.
//
// "Aprovar" advances the card to "aprovado" (Concluído). "Ajustes" does NOT
// move the card at all — it stays in "aprovacao" and only gets the client's
// comment attached, so the admin team sees the feedback on the card itself
// and decides the next step (e.g. drag it back to Revisão) manually.
export async function PATCH(request: Request, context: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await context.params;
    const safeSlug = validateSlug(slug);
    const session = await requireClientAccess(safeSlug);
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");

    const { action, comment } = clientApprovalActionSchema.parse(await request.json());
    const task = await getTaskById(id);
    if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
    const isOwnApprover = task.approver_id === session.userId;
    const isManager = session.level === "gerente";
    if (session.role === "client" && !isOwnApprover && !isManager) {
      throw new HttpError(403, "Apenas o aprovador designado (ou um gerente da conta) pode agir neste card.");
    }
    if (task.status !== "aprovacao") throw new HttpError(400, "Este card nao esta mais aguardando aprovacao.");

    const patch: Record<string, unknown> = {};
    if (action === "aprovar") {
      patch.status = "aprovado";
    }
    if (comment?.trim()) {
      const existing = task.payload as Record<string, unknown>;
      const comments = Array.isArray(existing.comments) ? existing.comments : [];
      const authorName = (await getProfileName(session.userId)) ?? session.email ?? "Cliente";
      patch.payload = {
        ...existing,
        comments: [...comments, { author: authorName, text: comment.trim(), at: new Date().toISOString() }],
      };
    }

    const updated = await updateTaskGroup(id, task, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
