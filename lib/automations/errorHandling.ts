// Uniform "an automation run failed" handling — see
// docs/reporting/report-pipeline.md. Every automation
// error (data fetch, PDF render, upload, missing eligibility) leaves a
// comment explaining what happened and moves the card to `parada`, instead
// of failing silently or crashing the whole cron tick.

import { PRE_PARADA_STATUS_KEY } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import { getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import { transitionTaskStatus, updateTaskPayload } from "./taskWrites";
import { notifyFromAutomation } from "./notify";

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

    // Entrega, molde recorrente e Plano de Ação não têm status próprio: ele é a
    // projeção dos cards abaixo, e o banco recusa a escrita direta (trigger
    // tasks_reject_manual_rollup_status). Tentar `parada` neles falhava calado e a
    // explicação do erro nunca chegava a ninguém. Aqui o erro vira só um
    // comentário visível no card — quem parou de verdade é a etapa, quando há uma.
    const projected = Boolean(task.workflow_version_id || task.recurrence_cadence || task.kind === "plano_acao");
    if (projected) {
      await updateTaskPayload(admin, taskId, { text: message });
      await notifyFromAutomation(admin, taskId, "task_commented", `Automação comentou em "${task.title}": ${message}`);
      return;
    }

    // Compare-and-set: uma falha atrasada nunca "para" uma etapa que um humano já
    // concluiu (ou que já parou) enquanto a automação ainda estava rodando.
    const halted = await transitionTaskStatus(admin, taskId, {
      to: "parada",
      unless: ["parada", "aprovado"],
      open: true,
      extra: { assignee: AUTOMATION_ASSIGNEE },
    });
    if (!halted) return;
    // Comentário e marcador entram por um UPDATE atômico, nunca por uma cópia do
    // payload lida antes — o que foi gravado no meio tempo sobrevive.
    await updateTaskPayload(admin, taskId, { text: message, patch: { [PRE_PARADA_STATUS_KEY]: task.status } });
    // Um card travado por falha de automação é justamente o que alguém precisa
    // saber sem ir procurar. Este caminho escreve com o service role, então
    // nunca passou pelo leque das rotas.
    await notifyFromAutomation(admin, taskId, "task_status_changed", `"${task.title}" parou: ${message}`);
  } catch (loggingError) {
    console.error("markTaskParada failed", { taskId, message: message.slice(0, 200), loggingError });
  }
}
