import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireCronSecret } from "@/lib/cron";
import { requireAdmin } from "@/lib/supabase/auth";
import { runAutomations } from "@/lib/automations/run";
import { remindUpcomingRoutines } from "@/lib/automations/routineReminders";
import { reportMissedAutomationCycles } from "@/lib/automations/moldHealth";
import { warnBeforeMetaCredentialFailure } from "@/lib/automations/metaCredentialHealth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileFlows } from "@/lib/flows/reconcile";

// Node runtime required by @react-pdf/renderer (lib/reports/adsReportPdf.tsx).
export const runtime = "nodejs";

// POST /api/admin/automations/run — cron-only entrypoint, called by
// pg_cron/pg_net (supabase/migrations/20260820000003_automation_cron.sql)
// with an EMPTY body, gated by x-cron-secret, not a user session.
//
// `{ configIds: [...] }` no corpo é a outra porta que `RunOptions` já previa
// ("reexecução manual, fluxo de exemplo") mas que nunca tinha um caminho de
// admin de verdade até aqui — gated por requireAdmin() em vez do segredo do
// cron. Existe pra depurar por que uma automação específica não gerou o que
// devia, sem esperar a próxima janela real de disparo nem rodar a varredura
// diária inteira (reconcileFlows/remindUpcomingRoutines ficam de fora desse
// caminho de propósito — são responsabilidade do cron, não de um teste
// pontual).
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { configIds?: unknown; today?: unknown };
    if (Array.isArray(body.configIds) && body.configIds.length > 0) {
      await requireAdmin();
      const summary = await runAutomations({
        configIds: body.configIds as string[],
        today: typeof body.today === "string" ? body.today : undefined,
      });
      return NextResponse.json(summary);
    }
    await requireCronSecret(request);
    const summary = await runAutomations();
    // Varredura dos fluxos em cascata na mesma batida diária. É ela que
    // garante a corretude: os gatilhos síncronos (updateTaskGroup) só existem
    // para o usuário ver a próxima etapa nascer na hora, e qualquer caminho de
    // escrita que os contorne cai aqui. Idempotente por id determinístico, então
    // rodar todo dia sobre etapas já cascateadas não escreve nada.
    const flows = await reconcileFlows();
    // Aviso de rotina chegando (lib/automations/routineReminders.ts). Falhar aqui
    // não pode derrubar a resposta das automações, que já rodaram.
    const routineReminders = await remindUpcomingRoutines(createAdminClient()).catch((error) => {
      console.error("routine reminders failed", error);
      return 0;
    });
    // Detector de ciclo perdido (lib/automations/moldHealth.ts). Roda DEPOIS das
    // automações no mesmo tique, para que um molde que acabou de executar já
    // esteja com o vencimento avançado e não seja acusado de ter falhado. Como
    // os avisos acima, não pode derrubar a resposta de quem já trabalhou.
    const missedCycles = await reportMissedAutomationCycles(createAdminClient()).catch((error) => {
      console.error("missed automation cycles detector failed", error);
      return 0;
    });
    // Sonda da credencial da Meta (lib/automations/metaCredentialHealth.ts): avisa
    // no card ANTES do vencimento, para a falha não estrear na segunda de manhã.
    const metaCredentialWarnings = await warnBeforeMetaCredentialFailure(createAdminClient()).catch((error) => {
      console.error("meta credential probe failed", error);
      return 0;
    });
    return NextResponse.json({ ...summary, flows, routineReminders, missedCycles, metaCredentialWarnings });
  } catch (error) {
    return apiError(error);
  }
}
