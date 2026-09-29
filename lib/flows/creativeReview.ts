import { returnEditFinalsToPreview } from "@/lib/creativeDriveSync";
import { getAdminTask, type AdminClient } from "@/lib/automations/taskAccess";
import { transitionTaskStatus } from "@/lib/automations/taskWrites";
import { approveTask } from "./approve";
import { reviewerIdsOf } from "./stepRole";
export type FeedbackDecision = "aprovar" | "ajustes" | "revisao";

/**
 * A decisão de quem revisa um card em Revisão (30/09). Só por BOTÃO: Aprovar
 * ou Solicitar revisão ("ajustes"). Comentário livre não decide mais nada —
 * antes a IA lia o texto da Edição e podia aprovar ou devolver sozinha. Vale
 * para qualquer card em Revisão em que o autor é revisor, não só Edição.
 */
export async function handleReviewDecision(
  admin: AdminClient,
  taskId: string,
  authorId: string,
  decision: FeedbackDecision | null,
): Promise<boolean> {
  if (decision !== "aprovar" && decision !== "ajustes") return false;
  const task = await getAdminTask(admin, taskId);
  if (!task || task.status !== "revisao") return false;
  if (!reviewerIdsOf(task).includes(authorId)) return false;
  const result = decision;
  if (result === "aprovar") {
    await approveTask(admin, task, { actorId: authorId, from: ["revisao"] });
  } else if (result === "ajustes") {
    const changed = await transitionTaskStatus(admin, task.id, { from: ["revisao"], to: "em_producao" });
    if (changed) {
      const { data: assignees, error: assigneeError } = await admin.from("task_assignees")
        .select("profile_id").eq("task_id", task.id);
      if (assigneeError) throw assigneeError;
      const ids = ((assignees ?? []) as { profile_id: string }[]).map((row) => row.profile_id).filter((id) => id !== authorId);
      if (ids.length) {
        const { error: notificationError } = await admin.from("notifications").insert(ids.map((profileId) => ({
          profile_id: profileId, task_id: task.id, type: "task_status_changed",
          message: `Revisão solicitada em "${task.title}". O card voltou para Em produção.`,
        })));
        if (notificationError) console.error("creative review notification failed", notificationError);
      }
      const { data: links, error: linksError } = await admin.from("task_links")
        .select("parent_id").eq("child_id", task.id).eq("relation_kind", "workflow_step");
      if (linksError) throw linksError;
      const creativeIds = ((links ?? []) as { parent_id: string }[]).map((link) => link.parent_id);
      // Só a Edição tem finais no Drive para voltar a Preview.
      if (creativeIds.length && task.subtype === "edicao") {
        try { await returnEditFinalsToPreview(admin, task.id, creativeIds); }
        catch (error) { console.error("creative review Drive sync failed", error); }
      }
    }
  }
  return true;
}
