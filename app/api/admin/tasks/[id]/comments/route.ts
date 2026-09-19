import { NextResponse, after } from "next/server";
import { apiError } from "@/lib/api";
import { appendTaskComment, deleteTaskComment, editTaskComment, getProfileName, getTaskById, listTeamMembers, mentionsName } from "@/lib/supabase";
import { commentsOf } from "@/lib/comments";
import { requireAdmin } from "@/lib/supabase/auth";
import { notifyProfiles, notifyTaskParticipants, taskCommentedMessage } from "@/lib/notifications";
import { HttpError, taskCommentCreateSchema, taskCommentDeleteSchema, taskCommentEditSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTrafficRevisionComment } from "@/lib/automations/run";
import { classifyVisualComment, handleConversionRevisionComment, markVisualClarificationResolved, recordFeedbackMetricComment, requestVisualClarification, requestVisualDetailClarification, visualRequestFromText } from "@/lib/automations/conversionFlow";
import { markTaskParada } from "@/lib/automations/errorHandling";
import { errorMessage } from "@/lib/automations/taskAccess";
import { resolveFlowCommentTarget } from "@/lib/flows/commentTarget";
import { ADS_REPORT_STEP_KEY, CONVERSION_REPORT_STEP_KEY } from "@/lib/automationWorkflow";

// Node.js: o hook do fluxo de conversão pode renderizar o PDF de vendas.
export const runtime = "nodejs";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Correções de mídia são semanticamente da etapa de anúncios, ainda que o
 * comentário tenha sido escrito no Feedback/Conversão.  O texto continua
 * persistido somente no destino canônico (a etapa que a UI resolveu), mas o
 * worker recebe o id da etapa de mídia para poder produzir uma nova revisão.
 * Mantemos a classificação deliberadamente conservadora: comentários
 * operacionais/editoriais não atravessam etapas.
 */
function isMediaCorrection(text: string): boolean {
  return /\b(api|meta|facebook|alcance|impress(?:ão|oes|ões)|clique(?:s)?|campanha|anúncio(?:s)?|graf(?:ico|ia)|gráfico(?:s)?|visibilidade|cpm|ctr|cpc)\b/i.test(text);
}

async function trafficSiblingFor(admin: ReturnType<typeof createAdminClient>, taskId: string, authorId: string): Promise<string | null> {
  const task = await getTaskById(taskId);
  if (!task || !["feedback", CONVERSION_REPORT_STEP_KEY].includes(task.subtype ?? "")) return null;
  const { data: parentRows, error: parentError } = await admin.from("task_links")
    .select("parent_id").eq("child_id", taskId).eq("relation_kind", "workflow_step").limit(1);
  if (parentError) throw parentError;
  const parentId = (parentRows?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!parentId) return null;
  const { data: links, error: linksError } = await admin.from("task_links")
    .select("child_id").eq("parent_id", parentId).eq("relation_kind", "workflow_step");
  if (linksError) throw linksError;
  for (const link of (links ?? []) as { child_id?: string }[]) {
    if (!link.child_id || link.child_id === taskId) continue;
    const sibling = await getTaskById(link.child_id);
    if (sibling?.subtype !== ADS_REPORT_STEP_KEY) continue;
    // Mídia é uma revisão do revisor. Sem revisor configurado, o fluxo antigo
    // continua permissivo (a etapa já é final automaticamente nesse cadastro).
    if (sibling.reviewer_id && sibling.reviewer_id !== authorId) return null;
    return sibling.id;
  }
  return null;
}

async function conversionSiblingFor(admin: ReturnType<typeof createAdminClient>, taskId: string): Promise<string | null> {
  const task = await getTaskById(taskId);
  if (!task) return null;
  if (task.subtype === CONVERSION_REPORT_STEP_KEY) return task.id;
  if (task.subtype !== "feedback") return null;
  const { data: parentRows, error: parentError } = await admin.from("task_links").select("parent_id").eq("child_id", taskId).eq("relation_kind", "workflow_step").limit(1);
  if (parentError) throw parentError;
  const parentId = (parentRows?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!parentId) return null;
  const { data: links, error: linksError } = await admin.from("task_links").select("child_id").eq("parent_id", parentId).eq("relation_kind", "workflow_step");
  if (linksError) throw linksError;
  for (const link of (links ?? []) as { child_id?: string }[]) {
    if (!link.child_id) continue;
    const sibling = await getTaskById(link.child_id);
    if (sibling?.subtype === CONVERSION_REPORT_STEP_KEY) return sibling.id;
  }
  return null;
}

function scheduleCommentAutomation(taskId: string, authorId?: string, text?: string, commentAt?: string | null) {
  after(async () => {
    const admin = createAdminClient();
    try {
      if (text) {
        const task = await getTaskById(taskId);
        const pending = task?.payload?.visual_request_pending as { instruction?: string; sourceCommentAt?: string | null } | undefined;
        const stage = task?.payload?.visual_clarification_stage;
        if (pending && stage === "target" && /funil|tabela|primeira p[áa]gina|leitura do per[íi]odo|an[úu]ncio|m[íi]dia/i.test(text) && !/largo|largura|sobrepos|padding|espa[çc]amento|fonte|texto|invad/i.test(text)) {
          await requestVisualDetailClarification(admin, taskId, { text: `${pending.instruction ?? ""} ${text}`, commentAt });
          return;
        }
        const visual = pending && stage === "detail"
          ? { kind: "clear" as const, instruction: `${pending.instruction ?? ""} ${text}` }
          : pending
            ? classifyVisualComment(`${pending.instruction ?? ""} ${text}`)
            : classifyVisualComment(text);
        if (visual.kind === "ambiguous") {
          await requestVisualClarification(admin, taskId, { text, commentAt });
          return;
        }
        if (visual.kind === "clear") {
          const request = visualRequestFromText(`${pending?.instruction ?? ""} ${text}`.trim(), pending?.sourceCommentAt ?? commentAt);
          await markVisualClarificationResolved(admin, taskId, text, commentAt, request);
          const conversionTaskId = await conversionSiblingFor(admin, taskId);
          if (conversionTaskId && request.target !== "ads") {
            await handleConversionRevisionComment(admin, conversionTaskId, request);
            return;
          }
        }
      }
      const mediaTaskId = text && authorId && isMediaCorrection(text)
        ? await trafficSiblingFor(admin, taskId, authorId)
        : null;
      // O caminho usual mantém a assinatura histórica (e a idempotência) dos
      // hooks. Quando há uma correção de mídia, o hook recebe a etapa correta.
      if (mediaTaskId) {
        await handleTrafficRevisionComment(admin, mediaTaskId, { instruction: text ?? "", authorId });
      } else {
        await handleTrafficRevisionComment(admin, taskId);
        await recordFeedbackMetricComment(admin, taskId);
        await handleConversionRevisionComment(admin, taskId);
      }
    } catch (hookError) {
      console.error("comment hook failed", { taskId, hookError });
      await markTaskParada(admin, taskId, `Falha ao processar o comentário: ${errorMessage(hookError)}`);
    }
  });
}

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
    const sourceComment = commentsOf(task.payload).slice().reverse().find((comment) => comment.author_id === session.userId && comment.text === text);
    scheduleCommentAutomation(targetId, session.userId, text, sourceComment?.at ?? null);
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
    const task = await editTaskComment(id, index, at, text);
    scheduleCommentAutomation(task.id);
    return NextResponse.json(task);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { index, at } = taskCommentDeleteSchema.parse(await request.json());
    const task = await deleteTaskComment(id, index, at);
    scheduleCommentAutomation(task.id);
    return NextResponse.json(task);
  } catch (error) { return apiError(error); }
}
