import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { appendTaskComment, deleteTaskComment, editTaskComment } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyTaskParticipants, taskCommentedMessage } from "@/lib/notifications";
import { HttpError, taskCommentCreateSchema, taskCommentDeleteSchema, taskCommentEditSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { text } = taskCommentCreateSchema.parse(await request.json());
    const task = await appendTaskComment(id, session.userId, text);
    await notifyTaskParticipants(id, "task_commented", taskCommentedMessage(task.title, session.email ?? "Alguém"));
    return NextResponse.json(task);
  } catch (error) { return apiError(error); }
}

// PATCH — edita o texto de um comentário. DELETE — remove um comentário.
// Os dois identificam o alvo por índice + carimbo `at`; ver edit_task_comment.
// Sem notificação de propósito: editar a própria frase não é atividade nova no
// card, e avisar todo mundo a cada correção de digitação seria ruído.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { index, at, text } = taskCommentEditSchema.parse(await request.json());
    return NextResponse.json(await editTaskComment(id, index, at, text));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { index, at } = taskCommentDeleteSchema.parse(await request.json());
    return NextResponse.json(await deleteTaskComment(id, index, at));
  } catch (error) { return apiError(error); }
}
