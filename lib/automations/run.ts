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
import { notifyFromAutomation, notifyResponsibilityHolders } from "./notify";
import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { inPeriod, previousPeriod } from "@/app/admin/performance/insights";
import type { WindsorSettings } from "@/lib/windsor";
import { renderAdsReportPdf } from "@/lib/reports/adsReportPdf";
import { creativeRows, mediaOutcome, mediaTotals } from "@/lib/reports/adsInsights";
import { collectAndStorePreviews } from "./creativeAssets";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { fetchPostsForAccount, reportPeriodFor, resolveTemplateConfig } from "./reportData";
import { advanceFlowMold, clonePlanForReport, ensureFlowOccurrence, materializeOccurrenceForReport } from "./execute";
import { ensureFeedbackCard, runConversionFlow } from "./conversionFlow";
import { nextTrafficRevision, recordTrafficReport, trafficReportFileName, type TrafficReportRow } from "./reportEntities";
import { logReportRun } from "./reportLog";
import { ensureFlowStep } from "@/lib/flows/advance";
import { flowStepTaskId } from "@/lib/flows/ids";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { commentsOf } from "@/lib/comments";
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
  /** A automação da qual esta depende (a de anúncios, para `relatorio_vendas`). */
  depends_on_config_id: string | null;
};

/** Uma tarefa recorrente vira PAI de um fluxo de feedback quando alguma
 *  automação `relatorio_vendas` ativa DECLARA depender desta automação de
 *  anúncios. Antes era deduzido de "as duas apontam pro mesmo card"
 *  (docs/audits/report-automation-flow.md, A6). */
async function hasDependentConversion(admin: AdminClient, trafficConfigId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("automation_configs")
    .select("id")
    .eq("depends_on_config_id", trafficConfigId)
    .eq("automation_key", "relatorio_vendas")
    .eq("active", true)
    .limit(1);
  if (error) throw error;
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

/** Semanas mostradas na tendência do relatório de anúncios. */
const TREND_WEEKS = 6;
/** Criativos com miniatura baixada por relatório. */
const PREVIEW_CAP = 24;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

async function fillReportCard(
  admin: AdminClient,
  actingTask: TaskRecord,
  target: TaskRecord,
  config: AutomationConfigRow,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
  occurrenceId: string | null,
  revisionInstruction: string | null = null,
): Promise<{ fileName: string; url: string; report: TrafficReportRow }> {
  const startedAt = Date.now();
  const clientId = target.client_id;
  if (!clientId) throw new Error("O card não pertence a nenhum cliente.");
  const client = await getClientById(clientId);
  if (!client) throw new Error("Cliente do card não encontrado.");

  const account = adsAccountFor(client.slug, windsor, meta);
  if (!account) throw new Error(`Cliente "${client.name}" não tem conta de anúncios (Windsor ou Meta) vinculada em Integrações.`);

  // Task comum sem recorrência: janela padrão de 7 dias. O período termina na
  // véspera da execução — na segunda às 9h, cobre segunda a domingo anteriores.
  const cadence: RecurringCadence = target.recurrence_cadence ?? "semanal";
  const period = reportPeriodFor(cadence, today);
  const prevPeriod = previousPeriod(period);
  // A janela cobre as últimas semanas para a tendência do relatório; o que entra
  // no snapshot continua sendo só a semana atual e a anterior.
  const trendFrom = shiftDays(period.from, -(TREND_WEEKS - 1) * 7);
  const { campaignPosts, adPosts } = await fetchPostsForAccount(account, windsor, meta, trendFrom < prevPeriod.from ? trendFrom : prevPeriod.from, period.to);
  const currentPosts = campaignPosts.filter((p) => inPeriod(p, period));
  const prevPosts = campaignPosts.filter((p) => inPeriod(p, prevPeriod));
  const currentAdPosts = adPosts.filter((p) => inPeriod(p, period));
  const prevAdPosts = adPosts.filter((p) => inPeriod(p, prevPeriod));

  // Previews: baixados agora (a URL do Facebook expira) e guardados no storage,
  // para o relatório de resultados mostrar a mesma imagem. Falha = card sem imagem.
  const outcome = mediaOutcome(mediaTotals(currentPosts));
  const creatives = creativeRows(currentAdPosts, outcome).rows.slice(0, PREVIEW_CAP);
  const { stored: previews, assets } = meta.accessToken && creatives.length
    ? await collectAndStorePreviews(admin, meta.accessToken, client.slug, period.to, creatives)
    : { stored: {}, assets: {} };

  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const pdfBuffer = await renderAdsReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: templateConfig,
    posts: currentPosts,
    prevPosts,
    adPosts: currentAdPosts,
    prevAdPosts,
    trendPosts: campaignPosts,
    previews: assets,
    revisionInstruction,
    generatedAt: new Date(),
  });

  // Revisão no nome e pasta única por geração: regerar a mesma semana (retry
  // depois de falha parcial, nova revisão) não colide mais no storage — antes o
  // nome fixo com upsert:false falhava e marcava o card `parada` (A2).
  const revision = await nextTrafficRevision(admin, actingTask.id);
  const fileName = trafficReportFileName(period.to, revision);
  const path = documentStoragePath(client.slug, fileName);
  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, pdfBuffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: urlData } = admin.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);

  const { data: docRows, error: docError } = await admin.from("documents").insert({
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
  }).select("id").limit(1);
  if (docError) throw docError;

  // O registro estruturado: os posts EXATAMENTE como entraram no PDF. É daqui que
  // a Automação 2 lê a mídia da semana, em vez de refazer a busca (A3). Sem
  // revisor não há revisão humana a esperar — a geração já é a versão final.
  // Com revisor, finaliza quando a etapa for aprovada (conversionFlow.ts).
  const report = await recordTrafficReport(admin, {
    clientId,
    taskId: actingTask.id,
    occurrenceId,
    period,
    revision,
    snapshot: { campaignPosts: currentPosts, prevCampaignPosts: prevPosts, adPosts: currentAdPosts, prevAdPosts, previews },
    documentId: (docRows?.[0] as { id: string } | undefined)?.id ?? null,
    finalizedAt: actingTask.reviewer_id ? null : new Date().toISOString(),
  });

  logReportRun({
    report_type: "traffic",
    automation_id: config.id,
    client_id: clientId,
    task_id: actingTask.id,
    period: `${period.from}..${period.to}`,
    revision,
    status: report.status,
    duration_ms: Date.now() - startedAt,
  });

  return { fileName, url: urlData.publicUrl, report };
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
  // Não depende mais de IA: o comentário é lido pelo parser determinístico
  // (lib/ai/commentParser.ts), e a IA é só um fallback opcional.
  const flowMode = Boolean(target.recurrence_cadence) && (await hasDependentConversion(admin, config.id));

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
      const { fileName, url } = await fillReportCard(admin, card1, target, config, windsor, meta, today, occ.id);
      // Tudo o que o gestor vê vai na ETAPA `trafego` (visível no quadro); a
      // ocorrência (flow_parent) é só o contêiner e não aparece em tela. O sinal
      // para a Automação 2 não é mais um marcador no payload: é a linha em
      // traffic_reports e o status dela.
      const { error: c1Error } = await admin
        .from("tasks")
        .update({
          status: "revisao",
          assignee: AUTOMATION_ASSIGNEE,
          payload: appendedCommentPayload(
            card1.payload,
            `Relatório de anúncios gerado e anexado: [${fileName}](${url})\n\nComente aqui caso queira algum ajuste neste relatório de anúncios.`,
          ),
        })
        .eq("id", card1.id);
      if (c1Error) throw c1Error;
      await advanceFlowMold(admin, target, today);
      // O Feedback nasce junto com o Tráfego — não espera revisão de ninguém.
      // ensureFeedbackCard é idempotente (processOccurrence chama de novo
      // como reforço, se este caminho não tiver rodado por algum motivo).
      await ensureFeedbackCard(admin, occ, today);
      await notifyFromAutomation(admin, card1.id, "task_commented", `Automação comentou em "${card1.title}".`);
      // Relatório de tráfego é assunto de quem gerencia tráfego, esteja ou não
      // no card — a frente do grid de Equipe & papéis é quem responde isso.
      await notifyResponsibilityHolders(admin, card1.id, "gestor_trafego", "task_commented", `Relatório de tráfego pronto em "${card1.title}".`);
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
    const { fileName, url } = await fillReportCard(admin, actingTask, target, config, windsor, meta, today, null);
    const payload = appendedCommentPayload(actingTask.payload, `Relatório de anúncios gerado e anexado: [${fileName}](${url})`);
    const { error: statusError } = await admin
      .from("tasks")
      .update({ status: "revisao", payload, assignee: AUTOMATION_ASSIGNEE })
      .eq("id", actingTask.id);
    if (statusError) throw statusError;
    await notifyFromAutomation(admin, actingTask.id, "task_commented", `Automação comentou em "${actingTask.title}".`);
    await notifyResponsibilityHolders(admin, actingTask.id, "gestor_trafego", "task_commented", `Relatório de tráfego pronto em "${actingTask.title}".`);
  } catch (error) {
    const message = errorMessage(error);
    await markTaskParada(admin, actingTask.id, `Falha ao gerar o relatório de anúncios: ${message}`);
    return { error: message };
  }
  return "ran";
}

// coleta_metrica_cliente fica de fora (roadmap R6.11 — ainda é só stub).
const RUN_KEYS = ["relatorio_trafego_semanal", "relatorio_vendas"] as const;

export type RunOptions = {
  /** Dia da execução (ISO). Padrão: hoje em UTC — o cron roda às 12:00 UTC (9h
   *  em Brasília), então o dia UTC e o de Brasília são o mesmo. */
  today?: string;
  /** Restringe a estas automações (reexecução manual, fluxo de exemplo). */
  configIds?: string[];
};

export async function runAutomations(options: RunOptions = {}): Promise<AutomationRunSummary> {
  const admin = createAdminClient();
  const summary: AutomationRunSummary = { processed: 0, succeeded: 0, errors: [] };
  const today = options.today ?? isoDay(new Date());

  let query = admin
    .from("automation_configs")
    .select("*")
    .in("automation_key", RUN_KEYS as unknown as string[])
    .eq("active", true);
  if (options.configIds?.length) query = query.in("id", options.configIds);
  const { data: configRows, error: configError } = await query;
  if (configError) throw configError;
  // Quem declara dependência roda depois de quem é dependido: a etapa `trafego`
  // e o registro em traffic_reports têm que existir antes da Automação 2
  // procurá-los no mesmo tique.
  const configs = ((configRows ?? []) as AutomationConfigRow[]).sort((a, b) =>
    Number(Boolean(a.depends_on_config_id)) - Number(Boolean(b.depends_on_config_id)),
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
        ? await runConversionFlow(admin, config, today)
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

/** Regera a revisão de tráfego a partir de um comentário editorial humano.
 * O comentário permanece na thread como instrução/auditoria; o PDF recebe uma
 * nova revisão e tudo o que dependia do snapshot anterior volta a aguardar. */
export async function handleTrafficRevisionComment(admin: AdminClient, taskId: string): Promise<void> {
  const trafficTask = await getAdminTask(admin, taskId);
  if (!trafficTask || trafficTask.subtype !== "trafego") return;
  const { data: links } = await admin.from("task_links").select("parent_id").eq("child_id", taskId).limit(1);
  const occurrenceId = (links?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!occurrenceId) return;
  const occ = await getAdminTask(admin, occurrenceId);
  const moldId = typeof occ?.payload?.recurrence_parent_id === "string" ? occ.payload.recurrence_parent_id : null;
  if (!occ || !moldId) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;
  const { data: rows } = await admin.from("automation_configs").select("*")
    .eq("target_task_id", moldId).eq("automation_key", "relatorio_trafego_semanal").eq("active", true).limit(1);
  const config = rows?.[0] as AutomationConfigRow | undefined;
  if (!config) return;
  const instruction = [...commentsOf(trafficTask.payload)].reverse().find((comment) => comment.author !== "Automação" && comment.author !== AUTOMATION_ASSIGNEE)?.text;
  if (!instruction) return;
  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  const today = occ.due_date ?? isoDay(new Date());
  const { fileName, url } = await fillReportCard(admin, trafficTask, mold, config, windsor, meta, today, occ.id, instruction);
  const { error } = await admin.from("tasks").update({
    status: "revisao",
    assignee: AUTOMATION_ASSIGNEE,
    payload: {
      ...appendedCommentPayload(trafficTask.payload, `Northia aplicou a instrução de revisão e gerou uma nova versão: [${fileName}](${url})`),
      traffic_revision_instruction: instruction,
    },
  }).eq("id", trafficTask.id);
  if (error) throw error;

  // O relatório de conversão depende do snapshot de tráfego; uma revisão nova
  // torna a coleta e a conversão anteriores obsoletas e pede novo feedback.
  const nextPayload = { ...(occ.payload ?? {}) } as Record<string, unknown>;
  delete nextPayload.feedback_source_at;
  delete nextPayload.sales_report_generated_at;
  await admin.from("tasks").update({ payload: nextPayload, status: "em_producao" }).eq("id", occ.id);
  const feedbackId = flowStepTaskId(occ.id, "feedback");
  const conversionId = flowStepTaskId(occ.id, "conversao");
  await admin.from("tasks").update({ status: "backlog" }).in("id", [feedbackId, conversionId]);
}
