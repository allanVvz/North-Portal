// Daily cron entrypoint, called by app/api/admin/automations/run/route.ts.
// Despacha por automation_key: `relatorio_trafego_semanal` (aqui) e
// `relatorio_conversao` (lib/automations/conversionFlow.ts). `provisionar_card_metricas`
// continua sendo um fan-out síncrono (lib/automations/provision.ts) e
// `coleta_metrica_cliente` ainda é só stub (roadmap R6.11).
//
// v2: one row per registered automation instance, bound to a target card
// whose OWN due date/cadence drives everything — see
// docs/reporting/report-pipeline.md. Every failure (missing eligibility,
// data fetch, PDF render, upload) marks the relevant card `parada` with an
// explanatory comment (lib/automations/errorHandling.ts) instead of failing
// silently or aborting the rest of the run.

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFromAutomation, notifyResponsibilityHolders } from "./notify";
import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { inPeriod, previousPeriod } from "@/app/admin/performance/insights";
import type { WindsorSettings } from "@/lib/windsor";
import { renderAdsReportPdf, trafficFinalViewOf } from "@/lib/reports/adsReportPdf";
import { creativeRows, mediaOutcome, mediaTotals } from "@/lib/reports/adsInsights";
import { collectAndStorePreviews } from "./creativeAssets";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { fetchPostsForAccount, reportPeriodFor, resolveTemplateConfig } from "./reportData";
import { advanceFlowMold, clonePlanForReport, ensureFlowOccurrence, materializeOccurrenceForReport } from "./execute";
import { runConversionFlow } from "./conversionFlow";
import { nextTrafficRevision, recordTrafficReport, trafficReportFileName, type TrafficReportRow } from "./reportEntities";
import { logReportRun } from "./reportLog";
import { materializeFirstStep } from "@/lib/flows/advance";
import { flowStepTaskId } from "@/lib/flows/ids";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { ADS_REPORT_STEP_KEY, CONVERSION_REPORT_STEP_KEY, FEEDBACK_STEP_KEY } from "@/lib/automationWorkflow";
import { commentsOf } from "@/lib/comments";
import { markTaskParada } from "./errorHandling";
import { errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import { automationCommentId, replaceAutomaticReportAttachment, transitionTaskStatus, updateTaskPayload } from "./taskWrites";
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
  /** Métricas (tags) que `relatorio_conversao` lê do comentário. */
  collect_metric_keys: string[] | null;
  /** A automação da qual esta depende (a de anúncios, para `relatorio_conversao`). */
  depends_on_config_id: string | null;
};

/** Uma tarefa recorrente vira PAI de um fluxo de feedback quando alguma
 *  automação `relatorio_conversao` ativa DECLARA depender desta automação de
 *  anúncios. Antes era deduzido de "as duas apontam pro mesmo card"
 *  (docs/audits/report-automation-flow.md, A6). */
async function dependentConversionConfig(
  admin: AdminClient,
  trafficConfigId: string,
): Promise<Pick<AutomationConfigRow, "id" | "target_task_id"> | null> {
  const { data, error } = await admin
    .from("automation_configs")
    .select("id,target_task_id")
    .eq("depends_on_config_id", trafficConfigId)
    .eq("automation_key", "relatorio_conversao")
    .eq("active", true)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as Pick<AutomationConfigRow, "id" | "target_task_id"> | undefined) ?? null;
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
  if (docError) {
    // Compensate the preceding Storage write: retries must not leave orphaned
    // report files when the corresponding document row was not persisted.
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    throw docError;
  }

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
    snapshot: { campaignPosts: currentPosts, prevCampaignPosts: prevPosts, adPosts: currentAdPosts, prevAdPosts, previews, trafficFinalView: trafficFinalViewOf(revisionInstruction) },
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

// Exportada só para o teste de geração concorrente (trafficGeneration.test.ts).
export async function runOneReportAutomation(
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

  // Modo-fluxo: M1 tem uma automação `relatorio_conversao` ativa → a ocorrência
  // desta semana vira PAI de um fluxo de feedback. A Automação 1 cria a
  // ocorrência + a etapa `trafego`, preenche essa etapa com o PDF do Meta e a
  // deixa em REVISÃO (um humano confere). O pedido de feedback e a etapa 2 são
  // da Automação 2. Sem molde de task_type — o fluxo é dinâmico.
  // Não depende mais de IA: o comentário é lido pelo parser determinístico
  // (lib/ai/commentParser.ts), e a IA é só um fallback opcional.
  const conversionConfig = target.recurrence_cadence
    ? await dependentConversionConfig(admin, config.id)
    : null;

  if (conversionConfig) {
    let card1: TaskRecord;
    let occ: TaskRecord;
    try {
      const deliveryMold = await getAdminTask(admin, conversionConfig.target_task_id);
      if (!deliveryMold?.recurrence_cadence) {
        throw new Error("A automação de conversão não aponta para uma Entrega recorrente.");
      }
      occ = await ensureFlowOccurrence(admin, deliveryMold, today);
      card1 = await materializeFirstStep(admin, occ)
        ?? await getAdminTask(admin, flowStepTaskId(occ.id, ADS_REPORT_STEP_KEY))
        ?? (() => { throw new Error("A primeira etapa da Entrega de Automação não foi materializada."); })();
      // Compare-and-set: só inicia se a etapa ainda está em Entrada, parada por
      // falha anterior, ou já em produção (retry depois de um crash no meio). Em
      // revisão/aprovação/aprovado o relatório já foi gerado ou uma pessoa já agiu;
      // regerar aqui rebaixaria a etapa (o trigger limpa `completed_at`).
      const started = await transitionTaskStatus(admin, card1.id, { to: "em_producao", from: ["backlog", "parada", "em_producao"] });
      if (!started) return "not_due";
      // A ativação carimba uma vez; um retry não a reescreve.
      const { error: activationError } = await admin.from("tasks")
        .update({ workflow_activated_at: new Date().toISOString() })
        .eq("id", occ.id)
        .is("workflow_activated_at", null);
      if (activationError) throw activationError;
      // O status da Entrega não é escrito: ele acompanha a etapa aberta (acima).
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, target.id, `Falha ao preparar o fluxo do relatório de anúncios: ${message}`);
      return { error: message };
    }
    try {
      const { fileName, url, report } = await fillReportCard(admin, card1, target, config, windsor, meta, today, occ.id);
      // Tudo o que o gestor vê vai na ETAPA `trafego` (visível no quadro); a
      // A ocorrência é só o contêiner versionado e não aparece no quadro. O sinal
      // para a Automação 2 não é mais um marcador no payload: é a linha em
      // traffic_reports e o status dela.
      //
      // O comentário entra por UPDATE atômico no thread que está no banco AGORA:
      // a geração acima leva segundos e uma pessoa pode ter comentado nesse
      // intervalo. Já o status é compare-and-set — se alguém moveu a etapa
      // enquanto o PDF era gerado, o relatório continua salvo e comentado, mas a
      // etapa não é rebaixada.
      await replaceAutomaticReportAttachment(admin, card1.id, {
        reportKind: "ads",
        text: `Relatório de anúncios gerado e anexado: [${fileName}](${url})\n\nComente aqui caso queira algum ajuste neste relatório de anúncios.`,
        commentId: automationCommentId("ads-report", card1.id, report.revision),
      });
      await transitionTaskStatus(admin, card1.id, { to: "revisao", from: ["em_producao"], extra: { assignee: AUTOMATION_ASSIGNEE } });
      // O molde avança depois de o PDF existir. A próxima Entrega só será
      // materializada quando a Conversão final for aprovada.
      await advanceFlowMold(admin, target, today);
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
    const { fileName, url, report } = await fillReportCard(admin, actingTask, target, config, windsor, meta, today, null);
    // Mesma regra do modo-fluxo: comentário atômico, status por compare-and-set.
    await replaceAutomaticReportAttachment(admin, actingTask.id, {
      reportKind: "ads",
      text: `Relatório de anúncios gerado e anexado: [${fileName}](${url})`,
      commentId: automationCommentId("ads-report", actingTask.id, report.revision),
    });
    await transitionTaskStatus(admin, actingTask.id, { to: "revisao", from: ["backlog", "em_producao", "parada"], extra: { assignee: AUTOMATION_ASSIGNEE } });
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
const RUN_KEYS = ["relatorio_trafego_semanal", "relatorio_conversao"] as const;

export type RunOptions = {
  /** Dia da execução (ISO). Padrão: hoje em UTC — o cron roda às 12:00 UTC (9h
   *  em Brasília), então o dia UTC e o de Brasília são o mesmo. */
  today?: string;
  /** Restringe a estas automações (reexecução manual, fluxo de exemplo). */
  configIds?: string[];
};

type AutomationRunRow = { id: string };

async function claimDailyRun(admin: AdminClient, config: AutomationConfigRow, today: string): Promise<AutomationRunRow | null> {
  const action = config.automation_key === "relatorio_conversao" ? "conversion_report" : "ads_report";
  const { data, error } = await admin.rpc("claim_automation_run", {
    p_config_id: config.id,
    p_occurrence_key: today,
    p_scheduled_for: `${today}T11:00:00.000Z`,
    p_action: action,
    p_occurrence_id: null,
  });
  if (error) throw error;
  return (data?.[0] as AutomationRunRow | undefined) ?? null;
}

async function finishRun(admin: AdminClient, runId: string, status: "succeeded" | "failed", lastError: string | null = null): Promise<void> {
  const { error } = await admin.from("automation_runs").update({
    status,
    last_error: lastError,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);
  if (error) throw error;
}

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
    const run = config.automation_key === "relatorio_trafego_semanal"
      ? await claimDailyRun(admin, config, today)
      : null;
    if (config.automation_key === "relatorio_trafego_semanal" && !run) continue;

    let outcome: RunOutcome;
    try {
      outcome = config.automation_key === "relatorio_conversao"
        ? await runConversionFlow(admin, config, today)
        : await runOneReportAutomation(admin, config, windsor, meta, today);
    } catch (error) {
      outcome = { error: errorMessage(error) };
    }
    if (outcome === "not_due") {
      if (run) await finishRun(admin, run.id, "succeeded");
      continue;
    }

    summary.processed += 1;
    if (outcome === "ran") summary.succeeded += 1;
    else summary.errors.push({ configId: config.id, message: outcome.error });

    if (run) {
      if (outcome === "ran") await finishRun(admin, run.id, "succeeded");
      else await finishRun(admin, run.id, "failed", outcome.error);
    }
  }

  return summary;
}

/** Regera a revisão de tráfego a partir de um comentário editorial humano.
 * O comentário permanece na thread como instrução/auditoria; o PDF recebe uma
 * nova revisão e tudo o que dependia do snapshot anterior volta a aguardar. */
export type TrafficRevisionCommentOptions = {
  /** Texto vindo de Feedback/Conversão quando a intenção é uma correção de mídia. */
  instruction?: string;
  authorId?: string;
};

export async function handleTrafficRevisionComment(
  admin: AdminClient,
  taskId: string,
  options: TrafficRevisionCommentOptions = {},
): Promise<void> {
  const trafficTask = await getAdminTask(admin, taskId);
  if (!trafficTask || trafficTask.subtype !== ADS_REPORT_STEP_KEY) return;
  if (options.authorId && trafficTask.reviewer_id && trafficTask.reviewer_id !== options.authorId) return;
  // Etapa já concluída: uma pessoa a aprovou. Comentário depois disso é conversa;
  // regenerar substituiria o relatório em que o Feedback e a Conversão já se
  // apoiam, e o status `revisao` que a geração grava reabriria a etapa.
  if (trafficTask.completed_at) return;
  const { data: links } = await admin.from("task_links").select("parent_id").eq("child_id", taskId).eq("relation_kind", "workflow_step").limit(1);
  const occurrenceId = (links?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!occurrenceId) return;
  const occ = await getAdminTask(admin, occurrenceId);
  const moldId = typeof occ?.payload?.recurrence_parent_id === "string" ? occ.payload.recurrence_parent_id : null;
  if (!occ || !moldId) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;
  // A etapa de anúncios pertence à Entrega, mas sua configuração pertence ao
  // molde de anúncios. Os dois são ligados por `depends_on_config_id`; procurar
  // a configuração diretamente no molde da Entrega só funciona em cadastros
  // antigos em que os dois produtos compartilhavam o mesmo card.
  const { data: directRows, error: directError } = await admin.from("automation_configs").select("*")
    .eq("target_task_id", moldId).eq("automation_key", "relatorio_trafego_semanal").eq("active", true).limit(1);
  if (directError) throw directError;
  let config = directRows?.[0] as AutomationConfigRow | undefined;
  if (!config) {
    const { data: conversionRows, error: conversionError } = await admin
      .from("automation_configs")
      .select("depends_on_config_id")
      .eq("target_task_id", moldId)
      .eq("automation_key", "relatorio_conversao")
      .eq("active", true)
      .not("depends_on_config_id", "is", null)
      .limit(1);
    if (conversionError) throw conversionError;
    const trafficConfigId = (conversionRows?.[0] as { depends_on_config_id?: string | null } | undefined)?.depends_on_config_id;
    if (trafficConfigId) {
      const { data: trafficRows, error: trafficError } = await admin.from("automation_configs").select("*")
        .eq("id", trafficConfigId).eq("automation_key", "relatorio_trafego_semanal").eq("active", true).limit(1);
      if (trafficError) throw trafficError;
      config = trafficRows?.[0] as AutomationConfigRow | undefined;
    }
  }
  if (!config) return;
  const instruction = options.instruction?.trim() || [...commentsOf(trafficTask.payload)].reverse().find((comment) => comment.author !== "Automação" && comment.author !== AUTOMATION_ASSIGNEE)?.text;
  if (!instruction) return;
  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  const today = occ.due_date ?? isoDay(new Date());
  const { fileName, url, report } = await fillReportCard(admin, trafficTask, mold, config, windsor, meta, today, occ.id, instruction);
  // A geração levou segundos: o comentário entra no thread que está no banco
  // AGORA (nunca numa cópia lida antes) e o status é compare-and-set. Uma pessoa
  // que concluiu a etapa nesse intervalo não tem a conclusão desfeita — o PDF
  // novo fica salvo e comentado, e nada mais é resetado.
  await updateTaskPayload(admin, trafficTask.id, {
    text: `North Ai aplicou a instrução de revisão e gerou uma nova versão: [${fileName}](${url})`,
    commentId: automationCommentId("ads-revision", trafficTask.id, report.revision),
    patch: { traffic_revision_instruction: instruction },
  });
  const moved = await transitionTaskStatus(admin, trafficTask.id, {
    to: "revisao",
    from: ["backlog", "em_producao", "revisao", "parada"],
    open: true,
    extra: { assignee: AUTOMATION_ASSIGNEE },
  });
  if (!moved) return;

  // O relatório de conversão depende do snapshot de tráfego; uma revisão nova
  // torna a coleta e a conversão anteriores obsoletas e pede novo feedback.
  await updateTaskPayload(admin, occ.id, { remove: ["feedback_source_at", "conversion_report_generated_at", "sales_report_generated_at"] });
  // A Entrega é projeção de suas etapas: escrever seu status diretamente é
  // recusado pelo trigger `tasks_project_parent_status`. A etapa de tráfego já
  // está em Revisão acima; a projeção do pai acompanha esse estado.
  const feedbackId = flowStepTaskId(occ.id, FEEDBACK_STEP_KEY);
  const conversionId = flowStepTaskId(occ.id, CONVERSION_REPORT_STEP_KEY);
  // Só etapas ainda abertas voltam para Entrada: uma etapa já concluída não é
  // reaberta por uma regeneração (o trigger limparia o `completed_at`).
  const { error: resetError } = await admin.from("tasks").update({ status: "backlog" }).in("id", [feedbackId, conversionId]).is("completed_at", null);
  if (resetError) throw resetError;
}
