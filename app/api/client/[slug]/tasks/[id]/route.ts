import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { notifyTaskParticipants, statusChangedMessage, taskCommentedMessage } from "@/lib/notifications";
import { eventCommentId, isCreativeStatusScope, recordStatusComment, statusChangeText, stepLabelOf } from "@/lib/flows/statusComments";
import { recordStepDelivery } from "@/lib/flows/stepDelivery";
import { getProfileName, getTaskById, updateTaskGroup } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { appendedCommentPayload, getAdminTask } from "@/lib/automations/taskAccess";
import { flowCommentTargetId } from "@/lib/flows/commentTarget";
import { advanceDeliveryForStep } from "@/lib/flows/advance";
import { deliveryParentIdsOf, isFlowDelivery } from "@/lib/taskRelations";
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
    const isDelivery = isFlowDelivery(task);
    if (!isDelivery && action === "aprovar" && deliveryParentIdsOf(task).length > 1) {
      throw new HttpError(409, "Esta etapa é usada por várias Entregas. Peça à equipe para aprovar no Criativo correto.");
    }
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
    // O comentário do cliente segue a MESMA regra do lado admin: escrito num
    // card de entrega, ele é gravado na ETAPA CORRENTE, não no pai (ver
    // lib/flows/commentTarget.ts). A rota recusa alteração de Entrega-pai;
    // esta proteção ainda cobre links antigos que abram o modal nela.
    //
    // O status pertence à etapa. A própria Entrega já foi recusada acima;
    // só a escrita do comentário pode ser deslocada para a etapa corrente.
    const admin = createAdminClient();
    const commentTargetId = await flowCommentTargetId(admin, task, session.userId);
    let commentAuthor: string | null = null;
    if (comment?.trim()) {
      commentAuthor = (await getProfileName(session.userId)) ?? session.email ?? "Cliente";
      if (commentTargetId === id) {
        patch.payload = appendedCommentPayload(task.payload, comment.trim(), commentAuthor);
      } else {
        // Client de SERVIÇO: a etapa não é `client_visible`, então a sessão do
        // cliente não tem permissão de escrever nela (política "tasks client
        // approve own" cobre só o card que ele aprova). Mesmo precedente de
        // lib/flows/advance.ts, que cria a etapa seguinte quando é o cliente
        // quem conclui a atual.
        const step = await getAdminTask(admin, commentTargetId);
        if (step) {
          const { error } = await admin
            .from("tasks")
            .update({ payload: appendedCommentPayload(step.payload, comment.trim(), commentAuthor), updated_at: new Date().toISOString() })
            .eq("id", commentTargetId);
          if (error) throw error;
        }
      }
    }

    let updated;
    // Aprovação do cliente também é mudança de status de criativo: fica no
    // thread no nome de quem aprovou (25/09), no mesmo lugar da regra admin.
    let statusNote: { targetId: string; stepId: string; stepLabel: string; perDelivery: boolean } | null = null;
    if (isDelivery) {
      // O portal exibe a Entrega projetada, não necessariamente a etapa bruta:
      // uma etapa compartilhada pode estar em Aprovação apenas neste elo.
      const stage = await getAdminTask(admin, commentTargetId);
      if (!stage || stage.id === id) throw new HttpError(409, "Esta Entrega não tem uma etapa atual. Atualize a página.");
      const { data: links, error: linksError } = await admin.from("task_links")
        .select("parent_id,status_override")
        .eq("child_id", stage.id).eq("relation_kind", "workflow_step");
      if (linksError) throw linksError;
      const link = links?.find((item) => item.parent_id === id);
      if (!link || (link.status_override ?? stage.status) !== "aprovacao") {
        throw new HttpError(409, "A etapa atual desta Entrega mudou. Atualize a página.");
      }
      if (action === "aprovar") {
        if (links!.length > 1 || link.status_override !== null) {
          const now = new Date().toISOString();
          let query = admin.from("task_links")
            .update({ status_override: "aprovado", completed_at_override: now, paused_from_status: null })
            .eq("parent_id", id).eq("child_id", stage.id).eq("relation_kind", "workflow_step");
          query = link.status_override === null ? query.is("status_override", null) : query.eq("status_override", link.status_override);
          const { data: changed, error: changeError } = await query.select("child_id").maybeSingle();
          if (changeError) throw changeError;
          if (!changed) throw new HttpError(409, "O andamento mudou. Atualize a página e tente novamente.");
          await advanceDeliveryForStep(admin, id, stage.id, session.userId);
          updated = { id, status: "aprovado", stage_task_id: stage.id };
          statusNote = { targetId: id, stepId: stage.id, stepLabel: stepLabelOf(stage), perDelivery: true };
        } else {
          updated = await updateTaskGroup(stage.id, stage, { status: "aprovado" }, session.userId);
          statusNote = { targetId: stage.id, stepId: stage.id, stepLabel: stepLabelOf(stage), perDelivery: false };
        }
      } else {
        updated = task;
      }
    } else {
      updated = await updateTaskGroup(id, task, patch, session.userId);
      if (action === "aprovar") statusNote = { targetId: id, stepId: id, stepLabel: stepLabelOf(task), perDelivery: false };
    }

    // O cliente comentando no portal era o caminho MUDO mais importante — e é
    // exatamente o caso para o qual `notify_task_participants` foi feita
    // SECURITY DEFINER (o cliente não tem permissão de escrever na caixa de
    // entrada de ninguém), coisa que nunca chegou a ser ligada. A regra é lida
    // dentro do banco, o que aqui é obrigatório: `site_settings` tem RLS
    // admin-only e uma sessão de cliente não conseguiria consultá-la.
    // Notifica o card que REALMENTE recebeu o comentário — o leque de
    // participantes da etapa é quem precisa ler o pedido de ajuste, e é lá que
    // o texto está.
    if (commentAuthor) {
      await notifyTaskParticipants(commentTargetId, "task_commented", taskCommentedMessage(task.title, commentAuthor));
    }
    if (action === "aprovar") {
      await notifyTaskParticipants(id, "task_status_changed", statusChangedMessage(task.title, "aprovado"));
    }
    if (statusNote && (isDelivery ? task.kind === "criativo" : await isCreativeStatusScope(admin, task))) {
      await recordStatusComment(admin, {
        targetId: statusNote.targetId,
        authorId: session.userId,
        text: statusChangeText(statusNote.stepLabel, "aprovacao", "aprovado", statusNote.perDelivery),
        commentId: eventCommentId("status"),
      });
      await recordStepDelivery(admin, statusNote.stepId);
    }
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
