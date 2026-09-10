import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { notifyTaskParticipants, statusChangedMessage, taskCommentedMessage } from "@/lib/notifications";
import { getProfileName, getTaskById, updateTaskGroup } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { appendedCommentPayload, getAdminTask } from "@/lib/automations/taskAccess";
import { flowCommentTargetId } from "@/lib/flows/commentTarget";
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
    // O comentário do cliente segue a MESMA regra do lado admin: escrito num
    // card de entrega, ele é gravado na ETAPA CORRENTE, não no pai (ver
    // lib/flows/commentTarget.ts). Não é um caso de canto: quando o cliente é
    // o aprovador e não há revisor, `deliveryStatusOnFinish` põe a PRÓPRIA
    // entrega em `aprovacao` — então "Solicitar ajustes" é clicado justamente
    // sobre uma entrega, e sem este desvio o feedback caía no card pai
    // enquanto o mesmo texto, escrito pelo admin, ia para a etapa.
    //
    // O STATUS continua sendo do pai: aprovar a entrega é aprovar a entrega.
    // Só a escrita do comentário é que se desloca — por isso as duas coisas
    // deixaram de viajar no mesmo `patch`.
    const admin = createAdminClient();
    const commentTargetId = await flowCommentTargetId(admin, task);
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

    const updated = await updateTaskGroup(id, task, patch, session.userId);

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
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
