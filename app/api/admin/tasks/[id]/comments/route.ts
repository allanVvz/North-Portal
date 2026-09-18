import { NextResponse, after } from "next/server";
import { apiError } from "@/lib/api";
import { appendTaskComment, deleteTaskComment, editTaskComment, getProfileName, getTaskById, listTeamMembers, mentionsName } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyProfiles, notifyTaskParticipants, taskCommentedMessage } from "@/lib/notifications";
import { HttpError, taskCommentCreateSchema, taskCommentDeleteSchema, taskCommentEditSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTrafficRevisionComment } from "@/lib/automations/run";
import { recordFeedbackMetricComment } from "@/lib/automations/conversionFlow";
import { markTaskParada } from "@/lib/automations/errorHandling";
import { errorMessage } from "@/lib/automations/taskAccess";
import { resolveFlowCommentTarget } from "@/lib/flows/commentTarget";

// Node.js: o hook do fluxo de conversão pode renderizar o PDF de vendas.
export const runtime = "nodejs";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { text, comment_id: commentId, stage_task_id: stageTaskId } = taskCommentCreateSchema.parse(await request.json());
    // Comentar no card PAI (a entrega) grava o comentário na ETAPA em que a
    // pessoa estava (`stage_task_id`) — ou, em chamada antiga sem ele, na única
    // etapa atual inequívoca; ambíguo é 409, nunca um palpite. A LEITURA não
    // muda (mergeFamilyComments já junta tudo no pai), só o destino da ESCRITA.
    // A regra inteira mora em lib/flows/commentTarget.ts porque a outra porta
    // de comentário (o portal do cliente) precisa responder exatamente a mesma
    // coisa; ver o cabeçalho daquele módulo.
    const parent = await getTaskById(id);
    const targetId = parent
      ? (await resolveFlowCommentTarget(createAdminClient(), parent, { commenterId: session.userId, stageTaskId })).targetId
      : id;
    const { task, inserted } = await appendTaskComment(targetId, session.userId, text, commentId ?? null);
    // Reenvio do mesmo comentário (retry, clique duplo): já foi gravado e já
    // disparou seus efeitos — não notifica, não menciona e não regenera de novo.
    if (!inserted) return NextResponse.json(task);
    // As notificações leem o id EFETIVO (a etapa), não o da URL.
    const authorName = (await getProfileName(session.userId)) ?? session.email ?? "Alguém";
    await notifyTaskParticipants(targetId, "task_commented", taskCommentedMessage(task.title, authorName));
    // @menção (ATA 14/09): quem foi citado recebe um aviso próprio, esteja ou
    // não no card. Best-effort — o comentário já foi gravado.
    if (text.includes("@")) {
      const mentioned = (await listTeamMembers().catch(() => []))
        .filter((member) => member.id !== session.userId && mentionsName(text, member.name))
        .map((member) => member.id);
      if (mentioned.length) {
        await notifyProfiles(mentioned, targetId, "task_mentioned", `${authorName} mencionou você em "${task.title}".`);
      }
    }
    // Um comentário no tráfego pede revisão editorial; no Feedback, uma métrica
    // válida atualiza a referência histórica, mas a aprovação continua humana.
    //
    // Isso roda DEPOIS da resposta (`after`): regerar o PDF leva dezenas de
    // segundos, e esperar por ele fazia o comentário sumir da tela até acabar —
    // a pessoa achava que tinha se perdido e escrevia de novo. Agora o comentário
    // aparece na hora e a nova versão chega como um comentário da automação.
    // Uma falha aqui não pode se perder calada: vira o mesmo aviso que as
    // automações usam — a etapa `parada` com um comentário explicando.
    const admin = createAdminClient();
    after(async () => {
      try {
        await handleTrafficRevisionComment(admin, targetId);
        await recordFeedbackMetricComment(admin, targetId);
      } catch (hookError) {
        console.error("comment hook failed", { taskId: targetId, hookError });
        await markTaskParada(admin, targetId, `Falha ao processar o comentário: ${errorMessage(hookError)}`);
      }
    });
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
