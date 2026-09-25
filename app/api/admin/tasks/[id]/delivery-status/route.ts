import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getClientFlowFlags, getTaskById, listRelatedTasks, updateTaskGroup } from "@/lib/supabase";
import { advanceDeliveryForStep, nextFlowStepCardOf } from "@/lib/flows/advance";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import { deliveryParentIdsOf, flowStepsOf, isFlowDelivery, stageInDelivery } from "@/lib/taskRelations";
import { feedbackMetricApprovalProblem } from "@/lib/automations/conversionFlow";
import { returnEditFinalsToPreview } from "@/lib/creativeDriveSync";
import { notifyTaskParticipants, statusChangedMessage } from "@/lib/notifications";
import { HttpError, TASK_STATUSES, type TaskRecord } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(TASK_STATUSES),
  stage_task_id: z.string().uuid().optional(),
  expected_status: z.enum(TASK_STATUSES).optional(),
});

/** Altera o andamento de UMA etapa nesta Entrega, preservando as demais. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "ID inválido.");
    const input = bodySchema.parse(await request.json());
    const delivery = await getTaskById(id);
    if (!delivery || !isFlowDelivery(delivery)) throw new HttpError(404, "Entrega não encontrada.");

    const steps = flowStepsOf(id, await listRelatedTasks(id));
    const stage = input.stage_task_id
      ? steps.find((candidate) => candidate.id === input.stage_task_id)
      : currentFlowStepOf(steps);
    if (!stage) throw new HttpError(409, "Esta etapa não pertence mais à Entrega. Atualize o card.");
    if (input.expected_status && stage.status !== input.expected_status) {
      throw new HttpError(409, "O andamento mudou. Atualize o card antes de tentar novamente.");
    }
    if (delivery.client_id && (input.status === "revisao" || input.status === "aprovacao")) {
      const flags = await getClientFlowFlags(delivery.client_id);
      if (input.status === "revisao" && !flags.revisaoAdmin) throw new HttpError(409, "A Revisão está desligada para este cliente.");
      if (input.status === "aprovacao" && !flags.aprovacaoAdmin) throw new HttpError(409, "A Aprovação está desligada para este cliente.");
    }
    if (input.status === "aprovado") {
      const problem = await feedbackMetricApprovalProblem(createAdminClient(), stage.id);
      if (problem) throw new HttpError(409, problem);
    }

    const storedStage = await getTaskById(stage.id);
    if (!storedStage) throw new HttpError(409, "A etapa foi removida. Atualize a Entrega.");
    const link = storedStage.parents.find((parent) => parent.id === id && parent.relation_kind === "workflow_step");
    if (!link) throw new HttpError(409, "A etapa foi desvinculada. Atualize a Entrega.");
    const contextual = deliveryParentIdsOf(storedStage).length > 1 || link.status_override != null;
    let next: TaskRecord | null = null;
    let driveSyncWarning: string | undefined;
    if (contextual) {
      const db = await createClient();
      const { error } = await db.rpc("set_delivery_stage_status", {
        p_delivery_id: id,
        p_child_id: stage.id,
        p_expected_status: stage.status,
        p_status: input.status,
      });
      if (error) throw new HttpError(409, error.message);
      if (input.status === "aprovado") {
        const outcome = await advanceDeliveryForStep(createAdminClient(), id, stage.id, session.userId);
        next = outcome.created[0] ?? null;
      }
    } else if (storedStage.status !== input.status) {
      const saved = await updateTaskGroup(stage.id, storedStage, { status: input.status }, session.userId);
      if (input.status === "aprovado") next = await nextFlowStepCardOf(createAdminClient(), saved);
    }
    if (storedStage.subtype === "edicao" && stage.status === "revisao" && input.status === "em_producao") {
      try {
        const sync = await returnEditFinalsToPreview(createAdminClient(), stage.id);
        if (sync.errors.length) driveSyncWarning = `${sync.errors.length} pasta(s) do Drive ainda precisam sincronizar.`;
      } catch { driveSyncWarning = "Não foi possível sincronizar os finais do Drive agora."; }
    }
    const [updatedStage, updatedDelivery] = await Promise.all([getTaskById(stage.id), getTaskById(id)]);
    if (!updatedStage || !updatedDelivery) throw new HttpError(503, "Andamento salvo; atualize o card para ver a etapa.");
    if (stage.status !== input.status) {
      try { await notifyTaskParticipants(id, "task_status_changed", statusChangedMessage(delivery.title, input.status)); }
      catch { /* O andamento já foi salvo; falha de notificação não desfaz a ação. */ }
    }
    return NextResponse.json({
      stage: updatedStage,
      effective_stage: stageInDelivery(updatedStage, id),
      delivery: updatedDelivery,
      next,
      ...(driveSyncWarning ? { drive_sync_warning: driveSyncWarning } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
