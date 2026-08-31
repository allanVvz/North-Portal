// Daily cron entrypoint for Automação 1 (relatorio_trafego_semanal), called
// by app/api/admin/automations/run/route.ts. Automação 2 has no cron leg —
// it's a synchronous fan-out only (lib/automations/provision.ts), triggered
// by the "Provisionar agora" button, never by this daily tick.
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
import {
  BUILTIN_PERFORMANCE_TEMPLATES,
  DEFAULT_BUILTIN_TEMPLATE,
  sanitizePerformanceTemplateConfig,
  type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";
import { fetchWindsorPosts, type MetaPost, type WindsorDatasource, type WindsorSettings } from "@/lib/windsor";
import { fetchMetaAdsInsights } from "@/lib/metaInsights";
import { renderAdsReportPdf } from "@/lib/reports/adsReportPdf";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { clonePlanForReport, materializeOccurrenceForReport } from "./execute";
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
};

export type AutomationRunSummary = {
  processed: number;
  succeeded: number;
  errors: { configId: string; message: string }[];
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodForCadence(cadence: RecurringCadence, endIso: string): Period {
  const days = cadence === "semanal" ? 7 : cadence === "quinzenal" ? 14 : 30;
  const to = new Date(`${endIso}T12:00:00Z`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

// performance_template_id e TEXT (aceita "builtin-*"), mas
// performance_templates.id e UUID. Consultar um id de builtin ali faz o
// Postgres devolver "invalid input syntax for type uuid" e derruba a execucao
// inteira da automacao — foi o que aconteceria com as configs que apontavam
// para builtins removidos. Por isso o id so vai ao banco quando e um UUID de
// verdade; qualquer outro id desconhecido cai no template padrao.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTemplateConfig(admin: AdminClient, templateId: string | null): Promise<PerformanceTemplateConfig> {
  const fallback = DEFAULT_BUILTIN_TEMPLATE.config;
  if (!templateId) return fallback;
  const builtin = BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === templateId);
  if (builtin) return builtin.config;
  if (!UUID_RE.test(templateId)) return fallback;
  const { data, error } = await admin.from("performance_templates").select("config").eq("id", templateId).limit(1);
  if (error) throw error;
  const row = data?.[0] as { config: unknown } | undefined;
  return row ? sanitizePerformanceTemplateConfig(row.config) : fallback;
}

async function fetchPostsForAccount(
  account: { windsorAccountId: string | null; metaAccountId: string | null; metaAccountName: string | null },
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  windowFrom: string,
  windowTo: string,
): Promise<MetaPost[]> {
  const posts: MetaPost[] = [];
  if (account.windsorAccountId && windsor.apiKey) {
    const enabled = (Object.keys(windsor.datasources) as WindsorDatasource[]).filter((ds) => windsor.datasources[ds]);
    for (const ds of enabled) {
      const fetched = await fetchWindsorPosts(windsor.apiKey, ds, windowFrom, windowTo);
      posts.push(...fetched.filter((p) => p.accountId === account.windsorAccountId));
    }
  }
  if (account.metaAccountId && meta.accessToken) {
    const fetched = await fetchMetaAdsInsights(meta.accessToken, account.metaAccountId, account.metaAccountName ?? "", windowFrom, windowTo);
    posts.push(...fetched);
  }
  return posts;
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
  const posts = await fetchPostsForAccount(account, windsor, meta, prevPeriod.from, period.to);
  const currentPosts = posts.filter((p) => inPeriod(p, period));
  const prevPosts = posts.filter((p) => inPeriod(p, prevPeriod));

  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const pdfBuffer = await renderAdsReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: templateConfig,
    posts: currentPosts,
    prevPosts,
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

type RunOutcome = "not_due" | "ran" | { error: string };

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
    // One new comment per run, success or failure (see memory
    // automations-comment-rule) — a standard line for now; each future cycle
    // appends another below it rather than overwriting. [label](url) renders
    // as a short link (the file's own name), not the raw URL — see
    // lib/comments.ts splitCommentText.
    const payload = appendedCommentPayload(actingTask.payload, `Relatório de anúncios gerado e anexado: [${fileName}](${url})`);
    const { error: statusError } = await admin
      .from("tasks")
      .update({ status: "revisao", payload, assignee: AUTOMATION_ASSIGNEE })
      .eq("id", actingTask.id);
    if (statusError) throw statusError;
    await notifyFromAutomation(
      admin,
      actingTask.id,
      "task_commented",
      `Automação comentou em "${actingTask.title}".`,
    );
  } catch (error) {
    const message = errorMessage(error);
    await markTaskParada(admin, actingTask.id, `Falha ao gerar o relatório de anúncios: ${message}`);
    return { error: message };
  }
  return "ran";
}

export async function runAutomations(): Promise<AutomationRunSummary> {
  const admin = createAdminClient();
  const summary: AutomationRunSummary = { processed: 0, succeeded: 0, errors: [] };
  const today = isoDay(new Date());

  const { data: configRows, error: configError } = await admin
    .from("automation_configs")
    .select("*")
    .eq("automation_key", "relatorio_trafego_semanal")
    .eq("active", true);
  if (configError) throw configError;
  const configs = (configRows ?? []) as AutomationConfigRow[];
  if (!configs.length) return summary;

  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);

  for (const config of configs) {
    if (config.last_run_date === today) continue; // already processed today (idempotency)
    let outcome: RunOutcome;
    try {
      outcome = await runOneReportAutomation(admin, config, windsor, meta, today);
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
