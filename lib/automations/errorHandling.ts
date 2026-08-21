// Uniform "an automation run failed" handling — see
// plan/AUTOMACOES-RELATORIO-TRAFEGO.md "Novo status parada". Every automation
// error (data fetch, PDF render, upload, missing eligibility) leaves a
// comment explaining what happened and moves the card to `parada`, instead
// of failing silently or crashing the whole cron tick.

import { PRE_PARADA_STATUS_KEY } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import { appendedCommentPayload, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";

/** Appends an "Automação" comment to `taskId` and moves it to `parada`,
 * freezing its progress at whatever status it was in before (see
 * lib/taskCatalog.ts taskProgress). Best-effort: logs and swallows its own
 * failure — a broken error-reporting path must never mask the original
 * error or crash the caller's loop. */
export async function markTaskParada(admin: AdminClient, taskId: string, message: string): Promise<void> {
  try {
    const task: TaskRecord | null = await getAdminTask(admin, taskId);
    if (!task) return;
    if (task.status === "parada") return; // already halted, don't stack duplicate comments/markers

    const payload = { ...appendedCommentPayload(task.payload, message), [PRE_PARADA_STATUS_KEY]: task.status };
    const { error: updateError } = await admin
      .from("tasks")
      .update({ status: "parada", payload, assignee: AUTOMATION_ASSIGNEE })
      .eq("id", taskId);
    if (updateError) throw updateError;
  } catch (loggingError) {
    console.error("markTaskParada failed", { taskId, message: message.slice(0, 200), loggingError });
  }
}
