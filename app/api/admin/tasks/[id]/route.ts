import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteTask, getTaskById, updateTask } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskPatchSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const patch = taskPatchSchema.parse(await request.json());

    let current: Awaited<ReturnType<typeof getTaskById>> = null;
    if (patch.status) current = await getTaskById(id);

    // Only gerente-level admins decide the approval gate either way — approve
    // (aprovado) or reopen a resolved card back to aprovacao — enforced here
    // so it holds regardless of surface (Kanban drag, TaskModal, Aprovações).
    const isApprovalDecision = patch.status === "aprovado" || (current?.status === "aprovado" && patch.status === "aprovacao");
    if (isApprovalDecision && session.level !== "gerente") {
      throw new HttpError(403, "Apenas gerentes podem aprovar ou reabrir um card.");
    }

    // Only the reviewer assigned on the card can move it out of Revisão —
    // internal review is never a free-for-all across the whole admin team.
    if (patch.status && patch.status !== "revisao") {
      if (current?.status === "revisao" && current.reviewer_id !== session.userId) {
        throw new HttpError(403, "Apenas o revisor designado pode mover este card para fora da Revisão.");
      }
    }

    const task = await updateTask(id, patch);
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
