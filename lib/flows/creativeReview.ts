import { aiComplete } from "@/lib/ai/complete";
import { returnEditFinalsToPreview } from "@/lib/creativeDriveSync";
import { getAdminTask, type AdminClient } from "@/lib/automations/taskAccess";
import { transitionTaskStatus } from "@/lib/automations/taskWrites";
import { runStatusRuleEvents } from "@/lib/automations/ruleEngine";
import { approveTask } from "./approve";
import { reviewerIdsOf } from "./stepRole";
import type { FeedbackDecision } from "@/lib/automations/internalFeedback";

async function reviewDecision(text: string): Promise<FeedbackDecision> {
  const normalized = text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^(aprovar|aprovado|aprovada|ok|aprovado!)\s*[.!]?$/.test(normalized)) return "aprovar";
  if (/^(ajustes|ajustar|devolver|corrigir)\s*[.!]?$/.test(normalized)) return "ajustes";
  try {
    const answer = await aiComplete({
      system: "Classifique a decisão de uma revisora de Edição criativa. Responda apenas aprovar, ajustes ou revisao. Aprovar exige aprovação explícita. Ajustes exige pedido de mudança. Na dúvida, revisao.",
      user: text, maxTokens: 20,
    });
    const value = answer.trim().toLowerCase();
    return value === "aprovar" || value === "ajustes" ? value : "revisao";
  } catch { return "revisao"; }
}

/** Uma decisão atua somente na Edição que recebeu o comentário. */
export async function handleCreativeReviewComment(
  admin: AdminClient,
  taskId: string,
  authorId: string,
  text: string,
  decision: FeedbackDecision | null,
): Promise<boolean> {
  const task = await getAdminTask(admin, taskId);
  if (!task || task.subtype !== "edicao" || task.status !== "revisao") return false;
  if (!reviewerIdsOf(task).includes(authorId)) return false;
  const result = decision ?? await reviewDecision(text);
  if (result === "aprovar") {
    await approveTask(admin, task, { actorId: authorId, from: ["revisao"] });
  } else if (result === "ajustes") {
    const changed = await transitionTaskStatus(admin, task.id, { from: ["revisao"], to: "em_producao" });
    if (changed) {
      try { await runStatusRuleEvents(task, changed); }
      catch (error) { console.error("creative review status rule failed", { taskId: task.id, error }); }
      const { data: assignees, error: assigneeError } = await admin.from("task_assignees")
        .select("profile_id").eq("task_id", task.id);
      if (assigneeError) throw assigneeError;
      const ids = ((assignees ?? []) as { profile_id: string }[]).map((row) => row.profile_id).filter((id) => id !== authorId);
      if (ids.length) {
        const { error: notificationError } = await admin.from("notifications").insert(ids.map((profileId) => ({
          profile_id: profileId, task_id: task.id, type: "task_status_changed",
          message: `Ajustes solicitados em "${task.title}". A Edição voltou para Em produção.`,
        })));
        if (notificationError) console.error("creative review notification failed", notificationError);
      }
      const { data: links, error: linksError } = await admin.from("task_links")
        .select("parent_id").eq("child_id", task.id).eq("relation_kind", "workflow_step");
      if (linksError) throw linksError;
      const creativeIds = ((links ?? []) as { parent_id: string }[]).map((link) => link.parent_id);
      if (creativeIds.length) {
        try { await returnEditFinalsToPreview(admin, task.id, creativeIds); }
        catch (error) { console.error("creative review Drive sync failed", error); }
      }
    }
  }
  return true;
}
