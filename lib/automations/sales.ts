// Automação 2 (relatorio_vendas) — fecha o fluxo relatorio_conversao.
//
// A cada tique da cron: para cada ocorrência em andamento do molde-alvo,
//  (b) lê o comentário humano da etapa `agendamentos`, extrai as conversões com
//      IA (lib/ai/extractConversionReport), grava em payload + task_metrics e
//      auto-conclui a etapa;
//  (c) quando a etapa `relatorio_trafego` está concluída E há conversões
//      gravadas, renderiza o PDF de vendas e anexa na ocorrência.
// Não filtra por due_date — reage ao comentário em qualquer dia. Idempotência
// por marcadores em payload (conversao_source_at / sales_report_generated_at).

import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { commentsOf } from "@/lib/comments";
import { flowStepTaskId } from "@/lib/flows/ids";
import { isFlowDelivery } from "@/lib/taskRelations";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { inPeriod, previousPeriod } from "@/app/admin/performance/insights";
import { extractConversionReport, type ConversionRow } from "@/lib/ai/extractConversionReport";
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

type StepPayload = Record<string, unknown> & {
  conversoes?: ConversionRow[];
  conversao_source_at?: string;
};
type OccPayload = Record<string, unknown> & { sales_report_generated_at?: string };

function totalsOf(conversoes: ConversionRow[]) {
  return {
    agendamentos: conversoes.length,
    vendas: conversoes.filter((c) => c.status === "fechado").length,
    receita: conversoes.reduce((sum, c) => sum + (c.valor ?? 0), 0),
  };
}

/** (b) — lê o comentário mais recente do responsável e grava as conversões. */
async function captureConversoes(admin: AdminClient, step: TaskRecord, clientId: string): Promise<{ done: boolean }> {
  const payload = (step.payload ?? {}) as StepPayload;
  if (step.status === "aprovado" && Array.isArray(payload.conversoes)) return { done: true };

  const sourceAt = payload.conversao_source_at;
  const human = [...commentsOf(step.payload)]
    .reverse()
    .find((c) => !AUTOMATION_AUTHORS.has(c.author) && (!sourceAt || c.at > sourceAt));
  if (!human) return { done: step.status === "aprovado" && Array.isArray(payload.conversoes) };

  const { conversoes, note } = await extractConversionReport(human.text);

  if (conversoes.length === 0) {
    const nextPayload = {
      ...appendedCommentPayload(
        step.payload,
        `Não consegui estruturar os números (${note}). Pode mandar uma linha por conversão? Ex.: "Vitrificação — R$ 1.200 — #2 — fechado".`,
      ),
      conversao_source_at: human.at,
    };
    await admin.from("tasks").update({ payload: nextPayload }).eq("id", step.id);
    step.payload = nextPayload;
    return { done: false };
  }

  const t = totalsOf(conversoes);
  await admin.from("task_metrics").upsert(
    {
      task_id: step.id,
      client_id: clientId,
      metrics: { agendamentos: String(t.agendamentos), vendas: String(t.vendas), receita: String(t.receita) },
      source: "cliente",
    },
    { onConflict: "task_id" },
  );

  const nextPayload = {
    ...appendedCommentPayload(
      step.payload,
      `Registrei ${t.agendamentos} agendamento(s), ${t.vendas} venda(s), R$ ${t.receita.toLocaleString("pt-BR")} em receita.`,
    ),
    conversoes,
    conversao_source_at: human.at,
  };
  const { error } = await admin
    .from("tasks")
    .update({ status: "aprovado", payload: nextPayload, assignee: AUTOMATION_ASSIGNEE })
    .eq("id", step.id);
  if (error) throw error;
  step.status = "aprovado";
  step.payload = nextPayload;
  await notifyFromAutomation(admin, step.id, "task_commented", `Automação registrou as conversões em "${step.title}".`);
  return { done: true };
}

/** (c) — gera o PDF de vendas quando o tráfego está concluído e há conversões. */
async function generateSalesReport(
  admin: AdminClient,
  config: AutomationConfigRow,
  mold: TaskRecord,
  occ: TaskRecord,
  step: TaskRecord,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<void> {
  const clientId = occ.client_id;
  if (!clientId) throw new Error("A ocorrência não pertence a nenhum cliente.");
  const client = await getClientById(clientId);
  if (!client) throw new Error("Cliente da ocorrência não encontrado.");
  const account = adsAccountFor(client.slug, windsor, meta);
  if (!account) throw new Error(`Cliente "${client.name}" não tem conta de anúncios vinculada em Integrações.`);

  const cadence: RecurringCadence = mold.recurrence_cadence ?? "semanal";
  const period = periodForCadence(cadence, occ.due_date ?? today);
  const prevPeriod = previousPeriod(period);
  const { campaignPosts, adPosts } = await fetchPostsForAccount(account, windsor, meta, prevPeriod.from, period.to);
  const config_ = await resolveTemplateConfig(admin, config.performance_template_id);
  const conversoes = ((step.payload ?? {}) as StepPayload).conversoes ?? [];

  const pdf = await renderSalesReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: config_,
    campaignPosts: campaignPosts.filter((p) => inPeriod(p, period)),
    prevCampaignPosts: campaignPosts.filter((p) => inPeriod(p, prevPeriod)),
    adPosts: adPosts.filter((p) => inPeriod(p, period)),
    conversoes,
    generatedAt: new Date(),
  });

  const fileName = `relatorio-vendas-${period.to}.pdf`;
  const path = documentStoragePath(client.slug, fileName, occ.id);
  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: urlData } = admin.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);

  const { error: docError } = await admin.from("documents").insert({
    client_id: clientId,
    task_id: occ.id,
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

  const nextPayload = {
    ...appendedCommentPayload(occ.payload, `Relatório de vendas gerado e anexado: [${fileName}](${urlData.publicUrl})`),
    sales_report_generated_at: new Date().toISOString(),
  };
  const { error: updErr } = await admin.from("tasks").update({ payload: nextPayload, assignee: AUTOMATION_ASSIGNEE }).eq("id", occ.id);
  if (updErr) throw updErr;
  // Não mexe no status da ocorrência — reconcileFlows() no mesmo tique fecha via
  // settleDelivery (a etapa `agendamentos` é a última).
  await notifyFromAutomation(admin, occ.id, "task_commented", `Automação anexou o relatório de vendas em "${occ.title}".`);
}

export async function runOneSalesAutomation(
  admin: AdminClient,
  config: AutomationConfigRow,
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  today: string,
): Promise<RunOutcome> {
  const mold = await getAdminTask(admin, config.target_task_id);
  if (!mold || mold.kind !== "relatorio_conversao" || !isFlowDelivery(mold) || !mold.recurrence_cadence) return "not_due";
  if (recurrenceStopped(mold.status)) return "not_due";

  const { data: occRows, error: occError } = await admin
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("payload->>recurrence_parent_id", mold.id)
    .is("completed_at", null);
  if (occError) throw occError;
  const occurrences = (occRows ?? []).map(asTaskRecord);
  if (!occurrences.length) return "not_due";

  let didSomething = false;
  for (const occ of occurrences) {
    if (((occ.payload ?? {}) as OccPayload).sales_report_generated_at) continue;

    const step = await getAdminTask(admin, flowStepTaskId(occ.id, "agendamentos"));
    if (!step) continue; // etapa ainda não criada

    let captured: { done: boolean };
    try {
      captured = await captureConversoes(admin, step, occ.client_id ?? "");
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, step.id, `Falha ao registrar as conversões: ${message}`);
      return { error: message };
    }
    if (!captured.done) { didSomething = true; continue; }

    const trafego = await getAdminTask(admin, flowStepTaskId(occ.id, "relatorio_trafego"));
    if (!trafego?.completed_at) { didSomething = true; continue; }

    try {
      await generateSalesReport(admin, config, mold, occ, step, windsor, meta, today);
      didSomething = true;
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, occ.id, `Falha ao gerar o relatório de vendas: ${message}`);
      return { error: message };
    }
  }

  return didSomething ? "ran" : "not_due";
}
