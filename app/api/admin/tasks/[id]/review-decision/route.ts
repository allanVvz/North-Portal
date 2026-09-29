import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { HttpError } from "@/lib/validation";
import { requireAdmin } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { asTaskRecord, getAdminTask } from "@/lib/automations/taskAccess";
import { advanceDeliveryForStep, advanceFlowAfterUpdate } from "@/lib/flows/advance";
import { returnEditFinalsToPreview } from "@/lib/creativeDriveSync";

const schema = z.object({
  decision: z.enum(["approve", "request_changes"]),
  justification: z.string().max(4000).nullable().optional(),
  expected_status: z.literal("revisao").default("revisao"),
  delivery_id: z.string().uuid().optional(),
  request_id: z.string().uuid(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "ID inválido.");
    const input = schema.parse(await request.json());
    const db = createAdminClient();
    const before = await getAdminTask(db, id);
    if (!before) throw new HttpError(404, "Tarefa não encontrada.");
    const { data, error } = await db.rpc("decide_task_review", {
      p_task_id: id,
      p_actor_id: session.userId,
      p_decision: input.decision,
      p_justification: input.justification?.trim() || null,
      p_expected_status: input.expected_status,
      p_request_id: input.request_id,
      p_delivery_id: input.delivery_id ?? null,
      p_actor_kind: "human",
    });
    if (error) {
      const message = error.message ?? "Não foi possível decidir esta revisão.";
      if (error.code === "42501") throw new HttpError(403, "Somente um revisor designado pode decidir este card.");
      if (error.code === "40001" || error.code === "P0002" || error.code === "23505") throw new HttpError(409, "A revisão, o vínculo ou a chave desta decisão já mudou. Atualize o card.");
      if (error.code === "22023") throw new HttpError(400, message);
      throw error;
    }
    const result = data as { task?: Record<string, unknown>; event_id?: string; replayed?: boolean };
    if (!result?.task) throw new HttpError(503, "A decisão foi salva, mas não foi possível atualizar o card.");
    const after = asTaskRecord(result.task);
    if (input.decision === "approve") {
      try {
        if (input.delivery_id) await advanceDeliveryForStep(db, input.delivery_id, id, session.userId);
        else await advanceFlowAfterUpdate(before, after, session.userId);
      } catch (advanceError) {
        console.error("review decision flow advance failed", advanceError);
      }
    } else if (!result.replayed && before.subtype === "edicao") {
      const deliveryIds = input.delivery_id
        ? [input.delivery_id]
        : before.parents.filter((parent) => parent.relation_kind === "workflow_step").map((parent) => parent.id);
      if (deliveryIds.length) {
        try { await returnEditFinalsToPreview(db, id, deliveryIds); }
        catch (syncError) { console.error("review decision Drive sync failed", syncError); }
      }
    }
    if (!result.replayed) {
      const { error: notificationError } = await db.rpc("notify_task_participants", {
        p_task_id: id,
        p_type: "task_status_changed",
        p_message: input.decision === "approve"
          ? `"${after.title}" foi aprovado.`
          : `Ajustes solicitados em "${after.title}". O card voltou para Em produção.`,
        p_actor: session.userId,
      });
      if (notificationError) console.error("review decision notification failed", notificationError);
    }
    return NextResponse.json({ ...data, task: after });
  } catch (error) {
    return apiError(error);
  }
}
