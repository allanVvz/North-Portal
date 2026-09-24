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
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { WindsorSettings } from "@/lib/windsor";
import { renderAdsReportPdf, trafficFinalViewOf } from "@/lib/reports/adsReportPdf";
import { creativeRows, mediaOutcome, mediaTotals } from "@/lib/reports/adsInsights";
import { collectAndStorePreviews } from "./creativeAssets";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { fetchPostsForAccount, reportPeriodFor, resolveTemplateConfig } from "./reportData";
import { advanceFlowMold, clonePlanForReport, ensureFlowOccurrence, materializeOccurrenceForReport } from "./execute";
import { runConversionFlow } from "./conversionFlow";
import { detachSupersededReportDocuments, nextTrafficRevision, recordTrafficReport, trafficReportFileName, type TrafficReportRow } from "./reportEntities";
import { logReportRun } from "./reportLog";
import { materializeFirstStep } from "@/lib/flows/advance";
import { flowStepTaskId } from "@/lib/flows/ids";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { recurrenceOccursOn, recurrenceRuleOf } from "@/lib/recurrence";
import { agencyToday } from "@/lib/time/agency";
import { ADS_REPORT_STEP_KEY, CONVERSION_REPORT_STEP_KEY, FEEDBACK_STEP_KEY } from "@/lib/automationWorkflow";
import { commentsOf } from "@/lib/comments";
import { markTaskParada } from "./errorHandling";
import { missedCycleCommentId, shortDate } from "./moldHealth";
import { nextStepNotice, withNextStepNotice } from "./nextStepNotice";
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

/**
 * Hoje é dia desta automação rodar?
 *
 * Para card RECORRENTE a pergunta é feita à REGRA (`recurrenceOccursOn`), não à
 * coluna `due_date`. O motivo é o incidente de 21/09/2026: `due_date` é um cursor
 * que alguém tem de empurrar, e era empurrado por dois caminhos diferentes — o
 * molde de anúncios avançava ao gerar o PDF, o da Entrega só na conclusão do
 * fluxo. Quando o avanço não acontecia (falha, ou etapa anterior ainda aberta), a
 * coluna congelava numa data passada e a igualdade estrita nunca mais casava: a
 * automação morria em silêncio. A regra (`cadence` + `weekdays` + `start_date`) é
 * configuração estável — ninguém a avança, então ninguém a esquece.
 *
 * Card COMUM (sem recorrência) continua no vencimento: ele não tem regra, e a
 * data dele é justamente o que a pessoa escolheu.
 */
function targetIsDue(target: TaskRecord, today: string): boolean {
  if ((target.recurrence_cadence || target.kind === "plano_acao") && recurrenceStopped(target.status)) return false;
  const rule = recurrenceRuleOf(target);
  return rule ? recurrenceOccursOn(rule, today) : target.due_date === today;
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

/** O dia de execução que reproduz a MESMA janela de um relatório já gerado.
 *
 *  Uma revisão é outra versão do mesmo relatório — tem de cobrir a mesma
 *  semana. Antes, regerar usava "hoje" e a janela andava junto: na CRIS
 *  (23/09) a revisão 1 cobria 15–21/09 e a 2 saiu em 17–23/09, enquanto o
 *  relatório de conversão da MESMA entrega continuava em 15–21 — dois PDFs da
 *  mesma semana discordando do período. Como `reportPeriodFor` termina na
 *  véspera do dia de execução, o dia que reproduz a janela é o seguinte ao fim
 *  dela. */
export function runDayForPeriodEnd(periodTo: string): string {
  return shiftDays(periodTo, 1);
}

/** Vendas que a equipe informou no Feedback DESTA semana, se já informou.
 *
 *  Lê `task_metrics` pelo período fechado (não por `created_at`), a mesma fonte
 *  e o mesmo eixo que `previousPeriodTotals` em conversionFlow.ts. Na primeira
 *  execução da cascata a linha ainda não existe e isto devolve null: o fecho do
 *  funil mostra só o pixel, e a soma aparece quando o tráfego é regerado depois
 *  do feedback. Não é o relatório de tráfego espiando a etapa seguinte — é um
 *  fato já gravado sobre o período, que a etapa seguinte gravou quando rodou.
 *
 *  Falha de leitura não derruba o relatório: sem o número, o funil só perde o
 *  fecho somado. */
async function informedSalesFor(admin: AdminClient, clientId: string, period: Period): Promise<number | null> {
  const { data, error } = await admin
    .from("task_metrics")
    .select("metrics")
    .eq("client_id", clientId)
    .eq("period_to", period.to)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const raw = ((data ?? [])[0] as { metrics?: Record<string, unknown> } | undefined)?.metrics?.vendas;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
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
  // véspera da execução — na segunda às 8h, cobre segunda a domingo anteriores.
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
    informedSales: await informedSalesFor(admin, clientId, period),
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

  // Só o recém-gerado fica pendurado no card: a revisão anterior da MESMA semana
  // sai de cena (continua na biblioteca do cliente). Sem isto o card acumulava
  // um PDF por regeração, todos do mesmo período.
  const novoDocId = (docRows?.[0] as { id: string } | undefined)?.id ?? null;
  await detachSupersededReportDocuments(admin, { taskId: actingTask.id, periodTo: period.to, keepDocumentId: novoDocId });

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
    documentId: novoDocId,
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
  if (!target) return "not_due";
  // Mesmo predicado do pré-filtro do ledger (`isDueToday`), repetido aqui de
  // propósito: é defesa em profundidade e o que os testes exercitam direto.
  // Cobre tanto "hoje não é dia" quanto recorrência encerrada (molde aprovado ou
  // parado), que não gera mais nada — a mesma regra dos ciclos manuais.
  if (!targetIsDue(target, today)) return "not_due";

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
      if (!started) {
        // Este `not_due` custou dois clientes em 21/09/2026. A etapa de tráfego
        // do ciclo ANTERIOR ainda estava em `revisao`, então a transição não
        // pegou, a função saiu por aqui — e, porque só `advanceFlowMold` (bem
        // depois) move o vencimento, o molde ficou congelado naquela data. Com o
        // gate `due_date = hoje` sendo estrito, isso é morte definitiva: todo dia
        // seguinte devolve `not_due` e `automation_runs` grava `succeeded`,
        // porque de fato não houve erro. Ninguém foi avisado de nada.
        //
        // Sair calado é o bug; o `not_due` em si está certo (regerar rebaixaria
        // uma etapa que uma pessoa já mexeu). Então o motivo vira comentário no
        // molde, com o MESMO id que `moldHealth` usaria — quem chegar primeiro
        // escreve, o outro é no-op.
        if (target.due_date) {
          await updateTaskPayload(admin, target.id, {
            text: `Esta automação não gerou o relatório de ${shortDate(target.due_date)}: a etapa "${card1.title}" do ciclo anterior ainda está em ${card1.status}.`
              + ` A próxima Entrega só é gerada quando a anterior é concluída — relatório de tráfego e relatório de conversão.`
              + ` Conclua a Entrega em aberto; se este ciclo for para ser abandonado, mova o vencimento deste card para a próxima data.`,
            commentId: missedCycleCommentId(config.id, target.due_date),
          });
        }
        return "not_due";
      }
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
        // O aviso da próxima etapa vem do workflow versionado da ocorrência, não de
        // uma lista fixa: reordenar as etapas na tela de Etapas muda a frase.
        text: withNextStepNotice(
          `Relatório de anúncios gerado e anexado: [${fileName}](${url})\n\nComente aqui caso queira algum ajuste neste relatório de anúncios.`,
          await nextStepNotice(admin, occ, ADS_REPORT_STEP_KEY),
        ),
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
  /** Dia da execução (ISO). Padrão: hoje NO FUSO DA AGÊNCIA (`agencyToday`), a
   *  mesma fonte que `routineReminders` e as telas usam. O cron roda às 11:00
   *  UTC (08:00 em Brasília), horário em que o dia UTC e o de Brasília
   *  coincidem — mas uma reexecução manual entre 21:00 e 00:00 BRT não coincide,
   *  e um `new Date()` em UTC diria "amanhã" e faria TODO molde cair em
   *  `not_due` sem erro nenhum. */
  today?: string;
  /** Restringe a estas automações (reexecução manual, fluxo de exemplo). */
  configIds?: string[];
};

type AutomationRunRow = { id: string };

async function claimDailyRun(admin: AdminClient, config: AutomationConfigRow, today: string): Promise<AutomationRunRow | null> {
  const action = config.automation_key === "relatorio_conversao" ? "conversion_report" : "ads_report";
  // `occurrence_key` é o PERÍODO, e não "o dia em que o cron passou". Como o
  // claim agora só acontece depois de `isDueToday` confirmar que hoje casa com a
  // regra, `today` É a data da ocorrência — a chave única
  // (config, occurrence_key, action) passa a significar "esta semana", em vez de
  // "esta execução". A diferença apareceu em 21/09/2026: com a chave sendo o dia
  // da execução, um redisparo manual no mesmo dia colidia com a linha gravada
  // pelo cron da manhã, e a reexecução era recusada.
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

/** O mesmo gate de `runOneReportAutomation`, avaliado ANTES de reivindicar um run
 *  no ledger — ver o comentário em `runAutomations`. Uma leitura a mais por
 *  config por dia, em troca de não queimar a chave de idempotência do dia. */
async function isDueToday(admin: AdminClient, config: AutomationConfigRow, today: string): Promise<boolean> {
  const target = await getAdminTask(admin, config.target_task_id);
  return Boolean(target) && targetIsDue(target!, today);
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
  const today = options.today ?? agencyToday();

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
    // O ledger só é tocado quando há mesmo um vencimento hoje. Antes, o claim
    // vinha ANTES de qualquer checagem: num dia sem vencimento (6 de 7) a
    // automação reivindicava um run, saía por `not_due` e gravava `succeeded`.
    // Duas consequências, as duas caras: `automation_runs` virava ruído — uma
    // linha verde por config por dia, sem nada ter acontecido — e, pior, a chave
    // (config, occurrence_key, action) ficava QUEIMADA para o resto do dia,
    // porque `claim_automation_run` não reivindica um `succeeded`. Em 21/09/2026
    // isso impediu a reexecução da CRIS CAR CARE depois de o problema real ter
    // sido resolvido: a config era abandonada aqui, antes de o vencimento ser
    // sequer avaliado, e só destravou com um UPDATE à mão no ledger.
    //
    // `runOneReportAutomation` mantém o mesmo gate — é defesa em profundidade e o
    // que os testes exercitam direto.
    if (config.automation_key === "relatorio_trafego_semanal" && !(await isDueToday(admin, config, today))) continue;

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

/** Entrega + molde + configuração de uma etapa de anúncios. Extraído de
 *  `handleTrafficRevisionComment` sem mudança de comportamento (24/09) para que
 *  a regeração de manutenção (`regenerateTrafficReport`) use exatamente a mesma
 *  resolução, em vez de uma cópia que envelhece à parte. */
type TrafficStepContext = { trafficTask: TaskRecord; occ: TaskRecord; mold: TaskRecord; config: AutomationConfigRow };

async function resolveTrafficStepContext(admin: AdminClient, taskId: string): Promise<TrafficStepContext | null> {
  const trafficTask = await getAdminTask(admin, taskId);
  if (!trafficTask || trafficTask.subtype !== ADS_REPORT_STEP_KEY) return null;
  const { data: links } = await admin.from("task_links").select("parent_id").eq("child_id", taskId).eq("relation_kind", "workflow_step").limit(1);
  const occurrenceId = (links?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!occurrenceId) return null;
  const occ = await getAdminTask(admin, occurrenceId);
  const moldId = typeof occ?.payload?.recurrence_parent_id === "string" ? occ.payload.recurrence_parent_id : null;
  if (!occ || !moldId) return null;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return null;
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
  if (!config) return null;
  return { trafficTask, occ, mold, config };
}

/** O dia de execução que reproduz a MESMA janela do relatório original desta
 *  etapa — nunca o dia de hoje. `revision: 1` é a âncora: as revisões seguintes
 *  herdariam qualquer deslocamento já ocorrido. */
async function runDayOfFirstRevision(admin: AdminClient, ctx: TrafficStepContext): Promise<string> {
  const { data, error } = await admin
    .from("traffic_reports")
    .select("period_to")
    .eq("task_id", ctx.trafficTask.id)
    .order("revision", { ascending: true })
    .limit(1);
  if (error) throw error;
  const periodoOriginal = (data?.[0] as { period_to?: string | null } | undefined)?.period_to ?? null;
  return periodoOriginal ? runDayForPeriodEnd(periodoOriginal) : ctx.occ.due_date ?? agencyToday();
}

/** Regeração de MANUTENÇÃO: redesenha o PDF da etapa de anúncios com o código
 *  atual, sem pedido humano nenhum.
 *
 *  Existe porque `handleTrafficRevisionComment` é o caminho errado para isto e a
 *  regra de 24/09 proíbe usá-lo assim: ele EXIGE uma instrução de revisão, a
 *  grava no card e a IMPRIME no PDF, na seção "Revisão solicitada". Regerar
 *  layout por ali obrigava a inventar uma frase — e a frase sintética
 *  ("Regerar o relatório com o layout atual…") vazou para o relatório que o
 *  time lê. Aqui não há instrução para inventar: `fillReportCard` recebe null e
 *  a seção simplesmente não existe.
 *
 *  Diferenças deliberadas do caminho de revisão, todas pelo mesmo motivo — uma
 *  mudança de layout não é um pedido de correção e não pode mover a cascata:
 *  - NÃO empurra a etapa para `revisao` nem troca o responsável;
 *  - NÃO limpa `feedback_source_at` / `conversion_report_generated_at`, então o
 *    feedback já colhido continua valendo;
 *  - NÃO devolve Feedback e Conversão para Entrada.
 *
 *  Etapa concluída continua sendo regerável aqui (diferente da revisão, que
 *  recusa): aprovar é sobre o conteúdo, e o conteúdo não muda. O PDF novo entra
 *  como revisão seguinte no storage, com o mesmo período do original. */
export async function regenerateTrafficReport(admin: AdminClient, taskId: string): Promise<{ fileName: string; url: string; revision: number } | null> {
  const ctx = await resolveTrafficStepContext(admin, taskId);
  if (!ctx) return null;
  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  const today = await runDayOfFirstRevision(admin, ctx);
  const { fileName, url, report } = await fillReportCard(admin, ctx.trafficTask, ctx.mold, ctx.config, windsor, meta, today, ctx.occ.id, null);
  await updateTaskPayload(admin, ctx.trafficTask.id, {
    text: `North Ai regerou o relatório com o layout atual — mesmo período, mesmos números: [${fileName}](${url})`,
    // Chaveado pelo PERÍODO, não pela revisão: a manutenção REESCREVE o próprio
    // comentário em vez de somar um por regeração. Chavear por revisão (como faz
    // o caminho de revisão logo abaixo, e ali está certo — cada pedido humano é
    // um evento distinto) deixava um comentário novo a cada redesenho, e todo
    // link de arquivo em comentário vira um ícone em Anexos: o card acumulava
    // "relatórios" que eram a mesma semana redesenhada (24/09).
    commentId: automationCommentId("ads-rerender", ctx.trafficTask.id, report.period_to),
  });
  return { fileName, url, revision: report.revision };
}

export async function handleTrafficRevisionComment(
  admin: AdminClient,
  taskId: string,
  options: TrafficRevisionCommentOptions = {},
): Promise<void> {
  const ctx = await resolveTrafficStepContext(admin, taskId);
  if (!ctx) return;
  const { trafficTask, occ, mold, config } = ctx;
  if (options.authorId && trafficTask.reviewer_id && trafficTask.reviewer_id !== options.authorId) return;
  // Etapa já concluída: uma pessoa a aprovou. Comentário depois disso é conversa;
  // regenerar substituiria o relatório em que o Feedback e a Conversão já se
  // apoiam, e o status `revisao` que a geração grava reabriria a etapa.
  if (trafficTask.completed_at) return;
  const instruction = options.instruction?.trim() || [...commentsOf(trafficTask.payload)].reverse().find((comment) => comment.author !== "Automação" && comment.author !== AUTOMATION_ASSIGNEE)?.text;
  if (!instruction) return;
  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  const today = await runDayOfFirstRevision(admin, ctx);
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
