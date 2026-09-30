import { aiComplete } from "@/lib/ai/complete";
import { getProfileName } from "@/lib/supabase";
import { approveTask } from "@/lib/flows/approve";
import { feedbackMetricApprovalProblem } from "./conversionFlow";
import { getAdminTask, type AdminClient } from "./taskAccess";
import { transitionTaskStatus, updateTaskPayload } from "./taskWrites";
import { advanceFlowAfterUpdate } from "@/lib/flows/advance";
import { runStatusRuleEvents } from "./ruleEngine";

export type FeedbackDecision = "aprovar" | "ajustes" | "revisao";

export function parseFeedbackDecision(value: string): FeedbackDecision {
  const normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^(aprovar|aprovado|aprovada|approve)[.!]?$/.test(normalized)) return "aprovar";
  if (/^(ajustes|ajustar|devolver|corrigir|changes)[.!]?$/.test(normalized)) return "ajustes";
  return "revisao";
}

async function classify(text: string): Promise<FeedbackDecision> {
  try {
    const answer = await aiComplete({
      system: "Classifique a decisão de um revisor de feedback interno. Responda somente uma palavra: aprovar, ajustes ou revisao. Use aprovar apenas quando a aprovação for explícita. Use ajustes quando houver pedido explícito de mudança. Em qualquer dúvida use revisao.",
      user: text, maxTokens: 20,
    });
    return parseFeedbackDecision(answer);
  } catch {
    return "revisao";
  }
}

export async function handleInternalFeedbackComment(
  admin: AdminClient,
  taskId: string,
  authorId: string,
  text: string,
  decision: FeedbackDecision | null,
  commentId: string,
): Promise<void> {
  const task = await getAdminTask(admin, taskId);
  if (!task || task.subtype !== "feedback" || !["em_producao", "revisao"].includes(task.status)) return;
  const reviewer = task.reviewer_id === authorId;
  const authorName = (await getProfileName(authorId))?.trim().toLowerCase() ?? "";
  const responsible = task.assignee_profile_ids.includes(authorId)
    || Boolean(authorName && task.assignee?.trim().toLowerCase() === authorName);
  if (!reviewer && !responsible) return;

  if (task.status === "em_producao" && responsible && !reviewer) {
    const changed = await transitionTaskStatus(admin, task.id, { from: ["em_producao"], to: "revisao" });
    if (changed) {
      await advanceFlowAfterUpdate(task, changed, authorId);
      await runStatusRuleEvents(task, changed);
    }
    return;
  }
  if (!reviewer) return;
  // A primeira resposta de quem também é responsável já pode decidir. Sem
  // decisão inequívoca, o card fica em Revisão aguardando uma escolha humana.
  if (task.status === "em_producao" && !responsible) return;
  const result = decision ?? await classify(text);
  if (result === "aprovar") {
    const problem = await feedbackMetricApprovalProblem(admin, task.id);
    if (problem) {
      await updateTaskPayload(admin, task.id, { text: `Aprovação pendente: ${problem}`, commentId: `feedback-decision:${commentId}` });
      if (task.status === "em_producao") {
        const changed = await transitionTaskStatus(admin, task.id, { from: ["em_producao"], to: "revisao" });
        if (changed) await runStatusRuleEvents(task, changed);
      }
      return;
    }
    await approveTask(admin, task, { actorId: authorId, from: [task.status] });
    return;
  }
  if (result === "ajustes" && task.status === "revisao") {
    const changed = await transitionTaskStatus(admin, task.id, { from: ["revisao"], to: "em_producao" });
    if (changed) {
      await advanceFlowAfterUpdate(task, changed, authorId);
      await runStatusRuleEvents(task, changed);
    }
    return;
  }
  if (task.status === "em_producao") {
    const changed = await transitionTaskStatus(admin, task.id, { from: ["em_producao"], to: "revisao" });
    if (changed) await runStatusRuleEvents(task, changed);
  }
  await updateTaskPayload(admin, task.id, {
    text: "A decisão deste feedback não ficou clara. O card permanece em Revisão; escolha Aprovar ou Pedir ajustes no próximo comentário.",
    commentId: `feedback-decision:${commentId}`,
  });
}
