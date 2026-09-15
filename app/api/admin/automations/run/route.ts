import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireCronSecret } from "@/lib/cron";
import { runAutomations } from "@/lib/automations/run";
import { remindUpcomingRoutines } from "@/lib/automations/routineReminders";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileFlows } from "@/lib/flows/reconcile";

// Node runtime required by @react-pdf/renderer (lib/reports/adsReportPdf.tsx).
export const runtime = "nodejs";

// POST /api/admin/automations/run — cron-only entrypoint, called by
// pg_cron/pg_net (supabase/migrations/20260820000003_automation_cron.sql).
// Gated by x-cron-secret, not a user session.
export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ ...summary, flows, routineReminders });
  } catch (error) {
    return apiError(error);
  }
}
