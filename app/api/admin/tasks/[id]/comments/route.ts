import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { appendTaskComment } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyTaskParticipants, taskCommentedMessage } from "@/lib/notifications";
import { HttpError, taskCommentCreateSchema } from "@/lib/validation";

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
