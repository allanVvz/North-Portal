import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { appendTaskComment, deleteTaskComment, editTaskComment, getTaskById } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyTaskParticipants, taskCommentedMessage } from "@/lib/notifications";
import { HttpError, taskCommentCreateSchema, taskCommentDeleteSchema, taskCommentEditSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleConversionComment } from "@/lib/automations/conversionFlow";
import { flowCommentTargetId } from "@/lib/flows/commentTarget";

// Node.js: o hook do fluxo de conversão pode renderizar o PDF de vendas.
export const runtime = "nodejs";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { text } = taskCommentCreateSchema.parse(await request.json());
    // Comentar no card PAI (a entrega) grava o comentário na ETAPA CORRENTE,
    // não no pai — a LEITURA não muda (mergeFamilyComments já junta tudo no
    // pai), só o destino da ESCRITA (P1-D). A regra inteira mora em
    // lib/flows/commentTarget.ts porque a outra porta de comentário (o portal
    // do cliente) precisa responder exatamente a mesma coisa; ver o cabeçalho
    // daquele módulo.
    const parent = await getTaskById(id);
    const targetId = parent ? await flowCommentTargetId(createAdminClient(), parent) : id;
    const task = await appendTaskComment(targetId, session.userId, text);
    // handleConversionComment e notifyTaskParticipants leem o id EFETIVO (a
    // etapa), não o da URL — é o card que de fato recebeu o comentário, e é
    // nele (não no pai) que uma automação como relatorio_vendas escuta e que
    // os participantes daquele card específico são notificados.
    await notifyTaskParticipants(targetId, "task_commented", taskCommentedMessage(task.title, session.email ?? "Alguém"));
    // Gatilho instantâneo do fluxo de feedback: se este card (ou o pai dele) tem
    // a automação `relatorio_vendas`, processa agora em vez de esperar o cron.
    await handleConversionComment(createAdminClient(), targetId);
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
