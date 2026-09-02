// Automação 2 (relatorio_vendas) — o "fluxo de feedback" genérico.
//
// Encaixada numa tarefa recorrente (M1), cada ocorrência dessa tarefa vira o
// PAI de um fluxo dinâmico (sem task_type): a Automação 1 cria a etapa `trafego`
// (relatório de anúncios do Meta); esta automação cria a etapa `feedback`
// quando alguém comenta os números no pai ou na etapa de tráfego, lê o
// comentário com IA (métricas configuráveis: tags livres), grava em
// `task_metrics`, gera o PDF de vendas e põe a etapa `feedback` + o pai em
// REVISÃO. Sem retorno até o prazo → a etapa nasce com zeros e fecha assim mesmo.
//
// Não filtra por due_date — reage ao comentário em qualquer dia. Idempotência
// por marcadores em payload (feedback_prompt_at / feedback_source_at /
// sales_report_generated_at). Também é chamada pontualmente pelo hook de
// comentário (processConversionFeedback), fora do cron.

import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { commentsOf, type TaskComment } from "@/lib/comments";
import { flowStepTaskId } from "@/lib/flows/ids";
import { ensureFlowStep, settleTypelessFlow } from "@/lib/flows/advance";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { inPeriod, previousPeriod } from "@/app/admin/performance/insights";
import { extractMetrics, type ConversionRow, type MetricExtract } from "@/lib/ai/extractMetrics";
import { CONVERSION_METRICS_DEFAULT, metricTagLabel } from "@/lib/metricTags";
import { renderSalesReportPdf } from "@/lib/reports/salesReportPdf";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { markTaskParada } from "./errorHandling";
import { appendedCommentPayload, asTaskRecord, errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import { notifyFromAutomation } from "./notify";
import { adsAccountFor, getClientById, type ServiceMetaSettings } from "./serviceIntegrations";
import type { WindsorSettings } from "@/lib/windsor";
import { fetchPostsForAccount, periodForCadence, resolveTemplateConfig } from "./reportData";
import type { AutomationConfigRow, RunOutcome } from "./run";

const AUTOMATION_AUTHORS = new Set(["Automação", AUTOMATION_ASSIGNEE]);
const FEEDBACK_LEAD_DAYS = 2;   // prazo do card de feedback = vencimento da ocorrência + 2
const TOLERANCIA_DIAS = 3;      // dias após o prazo antes de fechar com zeros

type OccPayload = Record<string, unknown> & {
  feedback_prompt_at?: string;
  feedback_source_at?: string;
  sales_report_generated_at?: string;
};

function nowIso() {
  return new Date().toISOString();
}
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function tagsOf(config: AutomationConfigRow): string[] {
  return config.collect_metric_keys?.length ? config.collect_metric_keys : CONVERSION_METRICS_DEFAULT;
}

function pedidoDe(tags: string[]): string {
  const lista = tags.map(metricTagLabel).join(", ");
  return `Informe num comentário aqui como foi a semana — ${lista}. Pode ser em texto corrido; a automação entende os números.`;
}

function resumoDe(valores: Record<string, number>, tags: string[]): string {
  return tags.map((t) => `${metricTagLabel(t)}: ${valores[t] ?? 0}`).join(" · ");
}

/** O comentário humano mais recente, em qualquer um dos cards, mais novo que `since`. */
function latestHumanComment(cards: TaskRecord[], since: string | undefined): (TaskComment & { taskId: string }) | null {
  const all = cards.flatMap((c) => commentsOf(c.payload).map((cm) => ({ ...cm, taskId: c.id })));
  const human = all
    .filter((c) => !AUTOMATION_AUTHORS.has(c.author) && (!since || c.at > since))
    .sort((a, b) => a.at.localeCompare(b.at));
  return human.length ? human[human.length - 1] : null;
}

async function openOccurrences(admin: AdminClient, moldId: string): Promise<TaskRecord[]> {
  const { data, error } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("payload->>recurrence_parent_id", moldId)
    .is("completed_at", null);
  if (error) throw error;
  return (data ?? []).map(asTaskRecord);
}

// ---- PDF de vendas ----------------------------------------------------------

async function generateSalesReport(
  admin: AdminClient,
  config: AutomationConfigRow,
  mold: TaskRecord,
  occ: TaskRecord,
  card2: TaskRecord,
  ext: MetricExtract,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<void> {
  const clientId = occ.client_id;
  if (!clientId) throw new Error("A ocorrência não pertence a nenhum cliente.");
  const client = await getClientById(clientId);
  if (!client) throw new Error("Cliente da ocorrência não encontrado.");
  const account = adsAccountFor(client.slug, windsor, meta);
  // Sem conta de anúncios não dá pra cruzar com o Meta — o PDF sai só com o que
  // o gestor relatou (sem investimento/ROAS). Não é erro.
  const cadence: RecurringCadence = mold.recurrence_cadence ?? "semanal";
  const period = periodForCadence(cadence, occ.due_date ?? today);
  const prevPeriod = previousPeriod(period);
  const { campaignPosts, adPosts } = account
    ? await fetchPostsForAccount(account, windsor, meta, prevPeriod.from, period.to)
    : { campaignPosts: [], adPosts: [] };
  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const conversoes: ConversionRow[] = ext.linhas;

  const pdf = await renderSalesReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: templateConfig,
    campaignPosts: campaignPosts.filter((p) => inPeriod(p, period)),
    prevCampaignPosts: campaignPosts.filter((p) => inPeriod(p, prevPeriod)),
    adPosts: adPosts.filter((p) => inPeriod(p, period)),
    conversoes,
    receitaTotal: typeof ext.valores.receita === "number" ? ext.valores.receita : null,
    vendasTotal: typeof ext.valores.vendas === "number" ? ext.valores.vendas : null,
    agendamentosTotal: typeof ext.valores.agendamentos === "number" ? ext.valores.agendamentos : null,
    seguidores: typeof ext.valores.seguidores === "number" ? ext.valores.seguidores : null,
    generatedAt: new Date(),
  });

  // Nome versionado: um comentário corrigido regera o PDF sem colidir no storage.
  const fileName = `relatorio-vendas-${period.to}.pdf`;
  const path = documentStoragePath(client.slug, `relatorio-vendas-${period.to}-${Date.now()}.pdf`, card2.id);
  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: urlData } = admin.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);

  const { error: docError } = await admin.from("documents").insert({
    client_id: clientId,
    task_id: card2.id,
    name: fileName,
    doc_type: "relatorio",
    status: "publicado",
    file_url: urlData.publicUrl,
    storage_path: path,
    original_file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: pdf.byteLength,
    doc_date: period.to,
  });
  if (docError) throw docError;

  const fresh = (await getAdminTask(admin, card2.id))?.payload ?? card2.payload;
  const { error: updErr } = await admin
    .from("tasks")
    .update({ payload: appendedCommentPayload(fresh, `Relatório de vendas gerado e anexado: [${fileName}](${urlData.publicUrl})`) })
    .eq("id", card2.id);
  if (updErr) throw updErr;
}

// ---- Orquestrador ---------------------------------------------------------

async function processOccurrence(
  admin: AdminClient,
  config: AutomationConfigRow,
  mold: TaskRecord,
  occ: TaskRecord,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<boolean> {
  const tags = tagsOf(config);
  let occPayload = (occ.payload ?? {}) as OccPayload;

  let card1 = await getAdminTask(admin, flowStepTaskId(occ.id, "trafego"));
  if (!card1 || !(card1.payload as Record<string, unknown>)?.trafego_report_at) return false; // espera a Autom. 1

  // Pedido único — na ETAPA `trafego` (visível no quadro; a ocorrência é só o
  // contêiner e não aparece em tela). O marcador de dedupe fica na ocorrência.
  if (!occPayload.feedback_prompt_at) {
    const { error: promptErr } = await admin
      .from("tasks")
      .update({ payload: appendedCommentPayload(card1.payload, pedidoDe(tags)) })
      .eq("id", card1.id);
    if (promptErr) throw promptErr;
    occPayload = { ...occPayload, feedback_prompt_at: nowIso() };
    const { error } = await admin.from("tasks").update({ payload: occPayload }).eq("id", occ.id);
    if (error) throw error;
    occ = { ...occ, payload: occPayload };
    card1 = (await getAdminTask(admin, card1.id)) ?? card1;
  }

  let card2 = await getAdminTask(admin, flowStepTaskId(occ.id, "feedback"));
  // O gestor comenta os números na etapa `trafego` (ou na `feedback` se já existe).
  const human = latestHumanComment([card1, ...(card2 ? [card2] : [])], occPayload.feedback_source_at);

  const agendDue = addDays(occ.due_date ?? today, FEEDBACK_LEAD_DAYS);
  const overdue = today >= addDays(agendDue, TOLERANCIA_DIAS);
  if (!human && !overdue) return true; // ainda dentro do prazo, esperando
  if (occPayload.sales_report_generated_at && !human) return false; // já fechado, sem novidade

  if (!card2) {
    card2 = await ensureFlowStep(admin, occ, "feedback", { title: "Feedback da semana", leadDays: FEEDBACK_LEAD_DAYS, clientVisible: true, position: 20 }, today);
  }

  const ext: MetricExtract = human
    ? await extractMetrics(human.text, tags)
    : { valores: Object.fromEntries(tags.map((t) => [t, 0])), linhas: [], note: "sem retorno do responsável" };

  // task_metrics — só as tags pedidas, como string.
  const metrics = Object.fromEntries(tags.map((t) => [t, String(ext.valores[t] ?? 0)]));
  const { error: metricsErr } = await admin.from("task_metrics").upsert(
    { task_id: card2.id, client_id: occ.client_id, metrics, source: "cliente" },
    { onConflict: "task_id" },
  );
  if (metricsErr) throw metricsErr;

  const sourceAt = human?.at ?? nowIso();
  const resumo = human
    ? `Registrei o feedback da semana — ${resumoDe(ext.valores, tags)}.`
    : `Sem retorno do responsável até o prazo — fechando a semana sem métricas registradas.`;
  const { error: c2Err } = await admin
    .from("tasks")
    .update({
      status: "revisao",
      assignee: AUTOMATION_ASSIGNEE,
      payload: {
        ...appendedCommentPayload(card2.payload, resumo),
        metricas: ext.valores,
        linhas: ext.linhas,
        feedback_source_at: sourceAt,
      },
    })
    .eq("id", card2.id);
  if (c2Err) throw c2Err;
  card2 = (await getAdminTask(admin, card2.id)) ?? card2;

  // Pai: só o estado + os marcadores estruturais (sem comentário — invisível).
  occPayload = { ...occPayload, feedback_source_at: sourceAt };
  const { error: occErr } = await admin.from("tasks").update({ payload: occPayload, status: "revisao" }).eq("id", occ.id);
  if (occErr) throw occErr;
  occ = { ...occ, payload: occPayload };

  // O PDF de vendas é anexado à ETAPA `feedback` (aparece nos Anexos dela e na
  // tela Documentos), com o comentário do link.
  await generateSalesReport(admin, config, mold, occ, card2, ext, windsor, meta, today);

  const { error: markErr } = await admin
    .from("tasks")
    .update({ payload: { ...((await getAdminTask(admin, occ.id))?.payload ?? {}), sales_report_generated_at: nowIso() } })
    .eq("id", occ.id);
  if (markErr) throw markErr;

  await notifyFromAutomation(admin, card2.id, "task_commented", `Automação anexou o relatório de vendas em "${card2.title}".`);
  return true;
}

export async function runConversionFlow(
  admin: AdminClient,
  config: AutomationConfigRow,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<RunOutcome> {
  const mold = await getAdminTask(admin, config.target_task_id);
  if (!mold || !mold.recurrence_cadence || recurrenceStopped(mold.status)) return "not_due";

  const occs = await openOccurrences(admin, mold.id);
  let didSomething = false;

  for (const occ of occs) {
    try {
      if (await processOccurrence(admin, config, mold, occ, windsor, meta, today)) didSomething = true;
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, occ.id, `Falha ao processar o feedback da semana: ${message}`);
      return { error: message };
    }
    // Fecho: quando os cards já foram aprovados por um humano.
    await settleTypelessFlow(admin, occ.id).catch(() => {});
  }

  return didSomething ? "ran" : "not_due";
}

/**
 * Chamado pelo hook de comentário: o card comentado pode ser a própria
 * ocorrência (pai do fluxo) ou uma etapa dela (`trafego`/`feedback`). Dispara o
 * processamento para toda ocorrência candidata. Best-effort — nunca lança.
 */
export async function handleConversionComment(admin: AdminClient, commentedTaskId: string): Promise<void> {
  try {
    const candidates = new Set<string>([commentedTaskId]);
    const { data: links } = await admin.from("task_links").select("parent_id").eq("child_id", commentedTaskId);
    for (const l of links ?? []) candidates.add((l as { parent_id: string }).parent_id);
    for (const id of candidates) await processConversionFeedback(admin, id);
  } catch {
    // O comentário já foi gravado; falha no hook não pode derrubar a resposta.
  }
}

/** Versão de-uma-ocorrência, chamada pelo hook de comentário (fora do cron). */
export async function processConversionFeedback(admin: AdminClient, occId: string): Promise<void> {
  const occ = await getAdminTask(admin, occId);
  if (!occ) return;
  const moldId = (occ.payload as Record<string, unknown>)?.recurrence_parent_id;
  if (typeof moldId !== "string") return;
  const { data } = await admin
    .from("automation_configs")
    .select("*")
    .eq("target_task_id", moldId)
    .eq("automation_key", "relatorio_vendas")
    .eq("active", true)
    .limit(1);
  const config = data?.[0] as AutomationConfigRow | undefined;
  if (!config) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;

  const { getMetaSettingsService, getWindsorSettingsService } = await import("./serviceIntegrations");
  const [windsor, meta] = await Promise.all([getWindsorSettingsService(), getMetaSettingsService()]);
  const today = new Date().toISOString().slice(0, 10);
  try {
    await processOccurrence(admin, config, mold, occ, windsor, meta, today);
    await settleTypelessFlow(admin, occId).catch(() => {});
  } catch (error) {
    await markTaskParada(admin, occId, `Falha ao processar o feedback da semana: ${errorMessage(error)}`);
  }
}
