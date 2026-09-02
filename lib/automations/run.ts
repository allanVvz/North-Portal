// Daily cron entrypoint, called by app/api/admin/automations/run/route.ts.
// Despacha por automation_key: `relatorio_trafego_semanal` (aqui) e
// `relatorio_vendas` (lib/automations/sales.ts). `provisionar_card_metricas`
// continua sendo um fan-out síncrono (lib/automations/provision.ts) e
// `coleta_metrica_cliente` ainda é só stub (roadmap R6.11).
//
// v2: one row per registered automation instance, bound to a target card
// whose OWN due date/cadence drives everything — see
// plan/AUTOMACOES-RELATORIO-TRAFEGO.md. Every failure (missing eligibility,
// data fetch, PDF render, upload) marks the relevant card `parada` with an
// explanatory comment (lib/automations/errorHandling.ts) instead of failing
// silently or aborting the rest of the run.

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFromAutomation } from "./notify";
import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { inPeriod, previousPeriod } from "@/app/admin/performance/insights";
import type { WindsorSettings } from "@/lib/windsor";
import { renderAdsReportPdf } from "@/lib/reports/adsReportPdf";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { fetchPostsForAccount, periodForCadence, resolveTemplateConfig } from "./reportData";
import { advanceFlowMold, clonePlanForReport, ensureFlowOccurrence, materializeOccurrenceForReport } from "./execute";
import { runConversionFlow } from "./conversionFlow";
import { ensureFlowStep } from "@/lib/flows/advance";
import { flowStepTaskId } from "@/lib/flows/ids";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { markTaskParada } from "./errorHandling";
import { appendedCommentPayload, errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import {
  adsAccountFor,
  getClientById,
  getMetaSettingsService,
  getWindsorSettingsService,
  type ServiceMetaSettings,
} from "./serviceIntegrations";

export type AutomationConfigRow = {
  id: string;
  automation_key: string;
  target_task_id: string;
  performance_template_id: string | null;
  active: boolean;
  last_run_date: string | null;
  /** Métricas (tags) que `relatorio_vendas` lê do comentário. */
  collect_metric_keys: string[] | null;
};

/** Uma tarefa recorrente vira PAI de um fluxo de feedback quando tem uma
 *  automação `relatorio_vendas` ativa apontando pra ela. */
async function hasConversionFlow(admin: AdminClient, targetTaskId: string): Promise<boolean> {
  const { data } = await admin
    .from("automation_configs")
    .select("id")
    .eq("target_task_id", targetTaskId)
    .eq("automation_key", "relatorio_vendas")
    .eq("active", true)
    .limit(1);
  return Boolean(data?.length);
}

export type AutomationRunSummary = {
  processed: number;
  succeeded: number;
  errors: { configId: string; message: string }[];
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fillReportCard(
  admin: AdminClient,
  actingTask: TaskRecord,
  target: TaskRecord,
  config: AutomationConfigRow,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<{ fileName: string; url: string }> {
  const clientId = target.client_id;
  if (!clientId) throw new Error("O card não pertence a nenhum cliente.");
  const client = await getClientById(clientId);
  if (!client) throw new Error("Cliente do card não encontrado.");

  const account = adsAccountFor(client.slug, windsor, meta);
  if (!account) throw new Error(`Cliente "${client.name}" não tem conta de anúncios (Windsor ou Meta) vinculada em Integrações.`);

  // Task comum sem recorrência: janela padrão de 7 dias terminando na data
  // que disparou a execução (ver plan/AUTOMACOES-RELATORIO-TRAFEGO.md).
  const cadence: RecurringCadence = target.recurrence_cadence ?? "semanal";
  const period = periodForCadence(cadence, today);
  const prevPeriod = previousPeriod(period);
  const { campaignPosts, adPosts } = await fetchPostsForAccount(account, windsor, meta, prevPeriod.from, period.to);
  const currentPosts = campaignPosts.filter((p) => inPeriod(p, period));
  const prevPosts = campaignPosts.filter((p) => inPeriod(p, prevPeriod));
  const currentAdPosts = adPosts.filter((p) => inPeriod(p, period));

  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const pdfBuffer = await renderAdsReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: templateConfig,
    posts: currentPosts,
    prevPosts,
    adPosts: currentAdPosts,
    generatedAt: new Date(),
  });

  const fileName = `relatorio-trafego-${period.to}.pdf`;
  const path = documentStoragePath(client.slug, fileName);
  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, pdfBuffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: urlData } = admin.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);

  const { error: docError } = await admin.from("documents").insert({
    client_id: clientId,
    task_id: actingTask.id,
    name: fileName,
    doc_type: "relatorio",
    status: "publicado",
    file_url: urlData.publicUrl,
    storage_path: path,
    original_file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: pdfBuffer.byteLength,
    doc_date: period.to,
  });
  if (docError) throw docError;

  return { fileName, url: urlData.publicUrl };
}

export type RunOutcome = "not_due" | "ran" | { error: string };

async function runOneReportAutomation(
  admin: AdminClient,
  config: AutomationConfigRow,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<RunOutcome> {
  const target = await getAdminTask(admin, config.target_task_id);
  if (!target || target.due_date !== today) return "not_due";
  // Recorrência encerrada (card-pai aprovado ou parado) não avança mais nem
  // gera novo relatório — mesma regra dos ciclos manuais. Vale para o alvo
  // recorrente e para o plano de ação recorrente.
  if ((target.recurrence_cadence || target.kind === "plano_acao") && recurrenceStopped(target.status)) return "not_due";

  // Modo-fluxo: M1 tem uma automação `relatorio_vendas` ativa → a ocorrência
  // desta semana vira PAI de um fluxo de feedback. A Automação 1 cria a
  // ocorrência + a etapa `trafego`, preenche essa etapa com o PDF do Meta e a
  // deixa em REVISÃO (um humano confere). O pedido de feedback e a etapa 2 são
  // da Automação 2. Sem molde de task_type — o fluxo é dinâmico.
  const flowMode = Boolean(target.recurrence_cadence) && (await hasConversionFlow(admin, target.id));

  if (flowMode) {
    let card1: TaskRecord;
    let occ: TaskRecord;
    try {
      occ = await ensureFlowOccurrence(admin, target, today);
      card1 = await ensureFlowStep(admin, occ, "trafego", { title: "Relatório de anúncios", leadDays: 0, position: 10 }, today);
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, target.id, `Falha ao preparar o fluxo do relatório de anúncios: ${message}`);
      return { error: message };
    }
    try {
      const { fileName, url } = await fillReportCard(admin, card1, target, config, windsor, meta, today);
      // Tudo o que o gestor vê vai na ETAPA `trafego` (visível no quadro); a
      // ocorrência (flow_parent) é só o contêiner e não aparece em tela.
      const { error: c1Error } = await admin
        .from("tasks")
        .update({
          status: "revisao",
          assignee: AUTOMATION_ASSIGNEE,
          payload: {
            ...appendedCommentPayload(card1.payload, `Relatório de anúncios gerado e anexado: [${fileName}](${url})`),
            trafego_report_at: new Date().toISOString(),
          },
        })
        .eq("id", card1.id);
      if (c1Error) throw c1Error;
      await advanceFlowMold(admin, target, today);
      await notifyFromAutomation(admin, card1.id, "task_commented", `Automação comentou em "${card1.title}".`);
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, card1.id, `Falha ao gerar o relatório de anúncios: ${message}`);
      return { error: message };
    }
    return "ran";
  }

  // Modo normal (sem fluxo de feedback): preenche a ocorrência / o card em si.
  let actingTask: TaskRecord;
  try {
    if (target.kind === "plano_acao") {
      actingTask = await clonePlanForReport(admin, target, today);
    } else if (target.recurrence_cadence) {
      actingTask = await materializeOccurrenceForReport(admin, target, today);
    } else {
      actingTask = target;
    }
  } catch (error) {
    const message = errorMessage(error);
    await markTaskParada(admin, target.id, `Falha ao preparar o card para o relatório de anúncios: ${message}`);
    return { error: message };
  }

  try {
    const { fileName, url } = await fillReportCard(admin, actingTask, target, config, windsor, meta, today);
    const payload = appendedCommentPayload(actingTask.payload, `Relatório de anúncios gerado e anexado: [${fileName}](${url})`);
    const { error: statusError } = await admin
      .from("tasks")
      .update({ status: "revisao", payload, assignee: AUTOMATION_ASSIGNEE })
      .eq("id", actingTask.id);
    if (statusError) throw statusError;
    await notifyFromAutomation(admin, actingTask.id, "task_commented", `Automação comentou em "${actingTask.title}".`);
  } catch (error) {
    const message = errorMessage(error);
    await markTaskParada(admin, actingTask.id, `Falha ao gerar o relatório de anúncios: ${message}`);
    return { error: message };
  }
  return "ran";
}

// coleta_metrica_cliente fica de fora (roadmap R6.11 — ainda é só stub).
const RUN_KEYS = ["relatorio_trafego_semanal", "relatorio_vendas"] as const;

export async function runAutomations(): Promise<AutomationRunSummary> {
  const admin = createAdminClient();
  const summary: AutomationRunSummary = { processed: 0, succeeded: 0, errors: [] };
  const today = isoDay(new Date());

  const { data: configRows, error: configError } = await admin
    .from("automation_configs")
    .select("*")
    .in("automation_key", RUN_KEYS as unknown as string[])
    .eq("active", true);
  if (configError) throw configError;
  // `relatorio_trafego_semanal` antes de `relatorio_vendas`: quando as duas
  // apontam pro mesmo card, a etapa `trafego` tem que existir antes.
  const configs = ((configRows ?? []) as AutomationConfigRow[]).sort((a, b) =>
    a.automation_key === b.automation_key ? 0 : a.automation_key === "relatorio_trafego_semanal" ? -1 : 1,
  );
  if (!configs.length) return summary;

  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);

  for (const config of configs) {
    // last_run_date guarda a Automação 1 (uma vez por dia). A Automação 2 reage
    // ao comentário do responsável em qualquer dia — a idempotência dela vem de
    // marcadores em payload — mas ainda gravamos a data para observabilidade.
    if (config.automation_key === "relatorio_trafego_semanal" && config.last_run_date === today) continue;

    let outcome: RunOutcome;
    try {
      outcome = config.automation_key === "relatorio_vendas"
        ? await runConversionFlow(admin, config, windsor, meta, today)
        : await runOneReportAutomation(admin, config, windsor, meta, today);
    } catch (error) {
      outcome = { error: errorMessage(error) };
    }
    if (outcome === "not_due") continue;

    summary.processed += 1;
    if (outcome === "ran") summary.succeeded += 1;
    else summary.errors.push({ configId: config.id, message: outcome.error });

    await admin.from("automation_configs").update({ last_run_date: today }).eq("id", config.id);
  }

  return summary;
}
