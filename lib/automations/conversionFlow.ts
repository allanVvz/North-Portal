// Automação 2 (relatorio_conversao), executada pela Entrega · Automação.
// A aprovação manual do relatório de anúncios abre Feedback; concluir esse
// card libera uma única etapa Relatório de conversão. Comentários fornecem os
// dados, mas nunca aprovam o Feedback e vencimento nunca o fecha sozinho.
//
// Idempotência em duas camadas: marcadores no payload (feedback_source_at /
// conversion_report_generated_at (com leitura histórica de sales_report_generated_at)
// decide se há algo novo; a
// reivindicação em `conversion_reports` (chave única por etapa + revisão do
// tráfego + comentário) impede duas execuções simultâneas de gerarem dois PDFs.
// Também é chamada pontualmente pelo hook de comentário
// (processConversionFeedback), fora do cron. Ver docs/reporting/report-pipeline.md.

import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { commentsOf } from "@/lib/comments";
import { consolidateAdaptiveFeedback, type AdaptiveMetricExtract, type SourcedComment } from "@/lib/ai/adaptiveFeedback";
import { addDaysIso, agencyToday } from "@/lib/time/agency";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { ADS_REPORT_STEP_KEY, CONVERSION_REPORT_STEP_KEY, FEEDBACK_STEP_KEY } from "@/lib/automationWorkflow";
import { workflowByVersionId, workflowStepByKey } from "@/lib/workflows";
import type { Period } from "@/app/admin/performance/insights";
import type { ConversionRow } from "@/lib/ai/extractMetrics";
import { feedbackTemplate } from "@/lib/ai/commentParser";
import { CONVERSION_METRICS_DEFAULT, metricTagLabel, needsRichExtraction } from "@/lib/metricTags";
import { renderSalesReportPdf, type SalesPrevTotals } from "@/lib/reports/salesReportPdf";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { markTaskParada } from "./errorHandling";
import { loadStoredPreviews } from "./creativeAssets";
import { assignResponsibilityHolders } from "./responsibleOwners";
import { asTaskRecord, errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import { automationCommentId, replaceAutomaticReportAttachment, transitionTaskStatus, updateTaskPayload } from "./taskWrites";
import { notifyFromAutomation, notifyResponsibilityHolders } from "./notify";
import { getClientById } from "./serviceIntegrations";
import { reportPeriodFor, resolveTemplateConfig } from "./reportData";
import { attributionOf, conversionModeOf } from "@/lib/reports/conversionMode";
import type { HistoryPoint } from "@/lib/reports/conversionFocus";
import {
  attachConversionDocument,
  claimConversionReport,
  currentTrafficReport,
  finalizationMoment,
  finalizeTrafficReport,
  recordConversionInterpretationSnapshot,
  releaseConversionReport,
  supersedePriorConversionReports,
  trafficReportIsFinal,
  type TrafficReportRow,
} from "./reportEntities";
import { logReportRun } from "./reportLog";
import { followerSeries, recordFollowerSnapshots } from "./clientMetricSeries";
import type { AutomationConfigRow, RunOutcome } from "./run";
import { buildNorthAIContext, buildReportContext, planWithNorthAI } from "@/lib/reports/conversionReportPlanning";

const AUTOMATION_AUTHORS = new Set(["Automação", AUTOMATION_ASSIGNEE]);

// A Automação 2 não depende mais de um provedor de IA: o pedido de feedback traz
// um modelo, lido pelo parser determinístico (lib/ai/commentParser.ts). Antes ela
// ficava dormente sem IA — e, com a chave da OpenAI cadastrada mas a organização
// não verificada, acordava para chamar um modelo que devolvia 404. A IA virou um
// fallback opcional (`COMMENT_AI_FALLBACK=1`, ver extractMetrics.ts).
// Prazo do card de feedback = vencimento da ocorrência + lead_days dele em
// A versão persistida do workflow guarda o prazo, o título e a posição.

// Descrição permanente do card — explica a FINALIDADE (por que responder
// importa), sempre visível mesmo antes de qualquer comentário. O formato
// técnico que o parser lê (pedidoDe) continua indo como comentário, uma vez,
// na criação — a descrição não muda card a card, não faz sentido reescrevê-la
// toda vez que o parser mudar de tags.
const FEEDBACK_DESCRIPTION = [
  "Este card existe para registrar os números reais da semana — vendas, agendamentos, seguidores e receita informados por quem acompanha o cliente.",
  "É a partir do que for respondido aqui que a automação gera o Relatório de conversão: o documento que mostra ao cliente o retorno real do investimento em anúncios, não só o desempenho de mídia (cliques, impressões).",
  "Sem uma resposta aqui, o relatório de conversão fecha sem números — e o cliente não vê o resultado financeiro do trabalho.",
].join("\n\n");

type OccPayload = Record<string, unknown> & {
  adaptive_source_fingerprint?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function tagsOf(config: AutomationConfigRow): string[] {
  return config.collect_metric_keys?.length ? config.collect_metric_keys : CONVERSION_METRICS_DEFAULT;
}

/** O pedido de feedback mostra o comentário CORRETO: o modelo que o parser lê sem
 *  IA. Uma informação por linha; linha ausente = não informado. */
function pedidoDe(tags: string[]): string {
  const regras = [
    'Deixe de fora a linha do que não souber: linha ausente fica como "não informado", e 0 é só quando foi zero.',
    ...(tags.includes("seguidores") ? ["Seguidores é o total do perfil no fim da semana, não o ganho."] : []),
    ...(needsRichExtraction(tags) ? ["As linhas com #1, #2 ou #3 são opcionais: uma por venda, com a origem do anúncio, o serviço e o valor."] : []),
  ];
  return [
    "Como foi a semana? Responda com um comentário neste card no modelo abaixo, trocando os números pelos da semana:",
    "",
    feedbackTemplate(tags),
    "",
    regras.join(" "),
  ].join("\n");
}

/**
 * Prepara a etapa `feedback` quando o relatório de anúncios é aprovado.
 * O prazo nasce da aprovação + dois dias corridos; repetir a mesma aprovação
 * não empurra o prazo outra vez.
 *
 * Responsável vem do papel `gestor_trafego` (Configurações › Equipe &
 * papéis), não de um nome craveado — hoje resolve para Allan e Luiza, sem o
 * código saber quem são. Sem ninguém no papel, cai no rótulo de automação.
 */
export async function prepareFeedbackCard(admin: AdminClient, occ: TaskRecord): Promise<TaskRecord | null> {
  const card = await linkedCardForStep(admin, occ, FEEDBACK_STEP_KEY);
  if (!card) return null;

  const moldId = (occ.payload as Record<string, unknown> | null)?.recurrence_parent_id;
  if (typeof moldId !== "string") return null;
  const { data } = await admin
    .from("automation_configs")
    .select("*")
    .eq("target_task_id", moldId)
    .eq("automation_key", "relatorio_conversao")
    .eq("active", true)
    .limit(1);
  const config = data?.[0] as AutomationConfigRow | undefined;
  if (!config) return null; // cliente sem relatorio_conversao configurado: este fluxo não tem Feedback

  const tags = tagsOf(config);
  const holderNames = await assignResponsibilityHolders(admin, card.id, "gestor_trafego");
  const alreadyPrompted = typeof card.payload?.feedback_prompted_at === "string";
  const openedOn = agencyToday();
  const feedbackDue = addDaysIso(openedOn, 2);
  // Colunas escalares primeiro, comentário depois: se algo falhar no meio, o
  // retry reencontra `feedback_prompted_at` ausente e refaz os dois — as datas
  // saem iguais (mesmo dia) e o comentário é idempotente pelo id.
  const { error } = await admin
    .from("tasks")
    .update({
      // Os gestores ficam exclusivamente em task_assignees; o texto livre seria
      // mesclado pela UI e voltaria a duplicar Allan/Luiza.
      assignee: holderNames ? null : AUTOMATION_ASSIGNEE,
      requires_review: false,
      description: FEEDBACK_DESCRIPTION,
      ...(!alreadyPrompted && !card.completed_at
        ? { start_date: openedOn, due_date: feedbackDue, end_date: feedbackDue }
        : {}),
    })
    .eq("id", card.id);
  if (error) throw error;
  if (!alreadyPrompted && !card.completed_at) {
    const { error: parentError } = await admin
      .from("tasks")
      .update({ due_date: feedbackDue, end_date: feedbackDue })
      .eq("id", occ.id);
    if (parentError) throw parentError;
  }
  if (!alreadyPrompted) {
    // O pedido e o marcador entram por UPDATE atômico no thread do banco; o id
    // garante um único pedido mesmo com duas conclusões/retries concorrentes.
    await updateTaskPayload(admin, card.id, {
      text: pedidoDe(tags),
      commentId: automationCommentId("feedback-prompt", card.id),
      patch: { feedback_prompted_at: nowIso() },
    });
  }
  return (await getAdminTask(admin, card.id)) ?? card;
}

/** Só as métricas que o gestor de fato informou. Listar "Vendas: 0" para quem
 *  não falou de vendas é a automação afirmando um resultado que ninguém deu —
 *  e o gestor lê isso como erro do sistema. */
function resumoDe(valores: Record<string, number | null>, tags: string[]): string {
  const ditas = tags.filter((t) => valores[t] !== null && valores[t] !== undefined);
  if (!ditas.length) return "nenhuma métrica identificada no comentário";
  return ditas.map((t) => `${metricTagLabel(t)}: ${valores[t]}`).join(" · ");
}

/** O que vai para `task_metrics`: a chave da métrica NÃO informada simplesmente
 *  não existe na linha. Mantém o jsonb como `Record<string,string>` (a tela de
 *  Performance lê esse mesmo formato em `listPublishedTasks`) e faz a série
 *  temporal distinguir "não informou" de "foi zero" — `previousPeriodTotals` já
 *  devolve `null` para chave ausente. */
function metricsParaBanco(valores: Record<string, number | null>, tags: string[]): Record<string, string> {
  return Object.fromEntries(
    tags.filter((t) => valores[t] !== null && valores[t] !== undefined).map((t) => [t, String(valores[t])]),
  );
}

/** Comentários humanos dos dois pontos de entrada, em ordem cronológica. */
function humanComments(cards: TaskRecord[]): SourcedComment[] {
  return cards
    .flatMap((card) => commentsOf(card.payload).map((comment) => ({ ...comment, taskId: card.id })))
    .filter((comment) => !AUTOMATION_AUTHORS.has(comment.author))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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

async function linkedCardForStep(admin: AdminClient, occ: TaskRecord, stepKey: string): Promise<TaskRecord | null> {
  if (!occ.workflow_version_id) return null;
  const workflow = await workflowByVersionId(admin, occ.workflow_version_id);
  const step = workflow ? workflowStepByKey(workflow, stepKey) : null;
  if (!step) return null;
  const { data, error } = await admin.from("task_links")
    .select("child_id")
    .eq("parent_id", occ.id)
    .eq("workflow_step_id", step.workflow_step_id)
    .eq("relation_kind", "workflow_step")
    .limit(1);
  if (error) throw error;
  const childId = (data?.[0] as { child_id?: string } | undefined)?.child_id;
  return childId ? getAdminTask(admin, childId) : null;
}

// ---- PDF de vendas ----------------------------------------------------------

/** Totais do período IMEDIATAMENTE anterior deste cliente, pra o PDF poder dizer
 *  "4 vendas (vs. 5 na semana passada)". Lê `task_metrics` pela coluna de
 *  período (não por `created_at`): uma re-execução ou um comentário corrigido
 *  dias depois não pode reordenar a série. Sem linha anterior → null, e o PDF
 *  simplesmente não mostra comparativo. */
async function previousPeriodTotals(
  admin: AdminClient,
  clientId: string,
  periodFrom: string,
): Promise<SalesPrevTotals | null> {
  const { data, error } = await admin
    .from("task_metrics")
    .select("metrics, period_from, period_to")
    .eq("client_id", clientId)
    .not("period_to", "is", null)
    .lt("period_to", periodFrom)
    .order("period_to", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { metrics?: Record<string, unknown>; period_from?: string | null; period_to?: string | null } | undefined;
  if (!row) return null;
  const num = (key: string): number | null => {
    const raw = row.metrics?.[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  return {
    vendas: num("vendas"),
    agendamentos: num("agendamentos"),
    receita: num("receita"),
    seguidores: num("seguidores"),
    seguidoresNovos: num("seguidores_novos"),
    // O PDF usa isto na legenda "comparado com X a Y" — o período real da linha,
    // que não é sempre o de calendário anterior (uma semana sem relatório deixa
    // um buraco na série).
    from: row.period_from ?? null,
    to: row.period_to ?? null,
  };
}

/** A série da conversão deste cliente até o período atual (inclusive), para o
 *  histórico do relatório de resultados. Mesma fonte e mesmo eixo de
 *  `previousPeriodTotals`: `task_metrics` por `period_to`, nunca por
 *  `created_at`. Chave ausente = não informado (null), nunca 0. */
async function conversionHistory(admin: AdminClient, clientId: string, periodTo: string): Promise<HistoryPoint[]> {
  const { data, error } = await admin
    .from("task_metrics")
    .select("metrics, period_to")
    .eq("client_id", clientId)
    .not("period_to", "is", null)
    .lte("period_to", periodTo)
    .order("period_to", { ascending: false })
    .limit(8);
  if (error) throw error;
  return ((data ?? []) as { metrics: Record<string, unknown> | null; period_to: string }[]).map((row) => {
    const read = (key: string): number | null => {
      const raw = row.metrics?.[key];
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    return { periodTo: row.period_to, vendas: read("vendas"), agendamentos: read("agendamentos"), receita: read("receita"), seguidores: read("seguidores"), seguidoresGanho: read("seguidores_novos") };
  });
}

async function generateSalesReport(
  admin: AdminClient,
  config: AutomationConfigRow,
  occ: TaskRecord,
  card2: TaskRecord,
  ext: AdaptiveMetricExtract,
  traffic: TrafficReportRow,
  cadence: RecurringCadence,
  period: Period,
  sourceCommentAt: string | null,
  sourceFingerprint: string,
  conversionReportId: string,
): Promise<string | null> {
  const clientId = occ.client_id;
  if (!clientId) throw new Error("A ocorrência não pertence a nenhum cliente.");
  const client = await getClientById(clientId);
  if (!client) throw new Error("Cliente da ocorrência não encontrado.");
  // A mídia vem do SNAPSHOT da revisão final do relatório de anúncios, não de
  // uma segunda busca na API: os dois PDFs da mesma semana mostram os mesmos
  // números (auditoria, A3), e esta pipeline não depende da API estar no ar.
  // Snapshot vazio (cliente sem conta de anúncios) = PDF só com o que o gestor
  // relatou, sem investimento/ROAS. Não é erro.
  const { campaignPosts = [], prevCampaignPosts = [], adPosts = [], prevAdPosts = [], previews: storedPreviews, trafficFinalView } = traffic.snapshot ?? {};
  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const conversoes: ConversionRow[] = ext.linhas;
  const [prevTotals, history, previews, followers] = await Promise.all([
    previousPeriodTotals(admin, clientId, period.from),
    conversionHistory(admin, clientId, period.to),
    loadStoredPreviews(admin, storedPreviews),
    followerSeries(admin, clientId, period.to),
  ]);
  const previousFollowers = followers.filter((point) => point.period_to < period.to).at(-1) ?? null;
  const effectivePrevTotals: SalesPrevTotals | null = prevTotals || previousFollowers || ext.seguidoresGanhoAnterior != null
    ? { vendas: prevTotals?.vendas ?? null, agendamentos: prevTotals?.agendamentos ?? null, receita: prevTotals?.receita ?? null, seguidores: prevTotals?.seguidores ?? previousFollowers?.value ?? null, seguidoresNovos: ext.seguidoresGanhoAnterior ?? prevTotals?.seguidoresNovos ?? null, from: prevTotals?.from ?? previousFollowers?.period_from ?? null, to: prevTotals?.to ?? previousFollowers?.period_to ?? null }
    : null;
  const historyWithFollowers = history.map((point) => ({ ...point, seguidores: followers.find((f) => f.period_to === point.periodTo)?.value ?? point.seguidores }));

  const reportContext = buildReportContext({
    period,
    metrics: {
      vendas: typeof ext.valores.vendas === "number" ? ext.valores.vendas : null,
      agendamentos: typeof ext.valores.agendamentos === "number" ? ext.valores.agendamentos : null,
      receita: typeof ext.valores.receita === "number" ? ext.valores.receita : null,
      seguidores: typeof ext.valores.seguidores === "number" ? ext.valores.seguidores : null,
      seguidoresNovos: ext.seguidoresGanho ?? null,
    },
    conversions: conversoes,
    campaigns: campaignPosts,
    ads: adPosts,
    interpretation: ext.interpretation,
    parser: ext.note,
    sourceFingerprint,
  });
  // NorthAI builds the client-facing context and Dashboard Architect chooses a
  // bounded visual plan. Both calls fall back to the deterministic plan.
  const planned = await planWithNorthAI({
    context: reportContext,
    northAIContext: buildNorthAIContext({
      client: { id: clientId, slug: client.slug, name: client.name },
      context: reportContext,
      adsFinal: traffic.status === "finalized",
      adsRevision: traffic.revision,
      editorialInstruction: trafficFinalView?.instruction ?? null,
    }),
  });
  const layoutPlan = planned.layout;
  reportContext.narrative = planned.narrative;
  const { error: planError } = await admin.from("conversion_reports").update({
    interpretation: {
      ...ext.interpretation,
      northai: {
        context: buildNorthAIContext({
          client: { id: clientId, slug: client.slug, name: client.name },
          context: reportContext,
          adsFinal: traffic.status === "finalized",
          adsRevision: traffic.revision,
          editorialInstruction: trafficFinalView?.instruction ?? null,
        }),
        narrative: planned.narrative,
        layoutPlan,
        aiUsed: planned.aiUsed,
      },
    },
  }).eq("id", conversionReportId);
  if (planError) throw planError;

  const pdf = await renderSalesReportPdf({
    clientName: client.name,
    period,
    cadenceLabel: RECURRENCE_CADENCE_LABEL[cadence] ?? cadence,
    config: templateConfig,
    campaignPosts,
    prevCampaignPosts,
    adPosts,
    prevAdPosts,
    previews,
    conversoes,
    receitaTotal: typeof ext.valores.receita === "number" ? ext.valores.receita : null,
    vendasTotal: typeof ext.valores.vendas === "number" ? ext.valores.vendas : null,
    agendamentosTotal: typeof ext.valores.agendamentos === "number" ? ext.valores.agendamentos : null,
    // Ganho e total do perfil são grandezas diferentes. Quando o comentário
    // diz "47 seguidores novos", não trate 47 como total e não o subtraia da
    // base anterior; o ganho vai explicitamente para a figura de conversão.
    seguidores: typeof ext.valores.seguidores === "number" ? ext.valores.seguidores : null,
    seguidoresNovos: ext.seguidoresGanho ?? null,
    prevSeguidoresNovos: ext.seguidoresGanhoAnterior ?? effectivePrevTotals?.seguidoresNovos ?? null,
    prevTotals: effectivePrevTotals,
    history: historyWithFollowers,
    adaptiveContext: ext.interpretation,
    trafficFinalView: trafficFinalView ?? null,
    reportContext,
    layout: { creativeCards: planned.layout.creativeCards },
    generatedAt: new Date(),
  });

  // Nome versionado: um comentário corrigido regera o PDF sem colidir no storage.
  const version = sourceFingerprint.slice(0, 12) || (sourceCommentAt ? sourceCommentAt.replace(/\D/g, "").slice(-14) : "initial");
  const fileName = `relatorio-conversao-${period.to}-${version}.pdf`;
  // A claim may be retried after a crash between document creation and the
  // final task update. Reuse that persisted artifact instead of creating a
  // second PDF/object for the same conversion card and period.
  const { data: existingRows, error: existingError } = await admin
    .from("documents")
    .select("id")
    .eq("task_id", card2.id)
    .eq("name", fileName)
    .limit(1);
  if (existingError) throw existingError;
  const existingId = (existingRows?.[0] as { id?: string } | undefined)?.id;
  if (existingId) return existingId;

  const path = documentStoragePath(client.slug, `relatorio-conversao-${period.to}-${Date.now()}.pdf`, card2.id);
  const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const { data: urlData } = admin.storage.from(DOCUMENT_BUCKET).getPublicUrl(path);

  const { data: docRows, error: docError } = await admin.from("documents").insert({
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
  }).select("id").limit(1);
  if (docError) {
    // Storage and Postgres are not one transaction. Compensate immediately so
    // retrying the failed run cannot leak an unreferenced PDF.
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    throw docError;
  }

  // Atômico e idempotente: nada de reler o payload para regravá-lo inteiro.
  await replaceAutomaticReportAttachment(admin, card2.id, {
    reportKind: "conversion",
    text: `Relatório de conversão atualizado — leitura e layout revisados para o período. [${fileName}](${urlData.publicUrl})`,
    // Sem o `path`: ele carrega slug + uuid + timestamp e estouraria o limite de
    // 128 caracteres do id. (card, período) já identifica a conversão — o retry
    // que reencontra o documento já retorna antes de chegar aqui.
    commentId: automationCommentId("conversion-report", card2.id, layoutPlan.fingerprint.slice(0, 16), fileName),
  });
  return (docRows?.[0] as { id: string } | undefined)?.id ?? null;
}

// ---- Orquestrador ---------------------------------------------------------

async function processOccurrence(
  admin: AdminClient,
  config: AutomationConfigRow,
  mold: TaskRecord,
  occ: TaskRecord,
  today: string,
): Promise<boolean> {
  const startedAt = Date.now();
  const tags = tagsOf(config);
  const occPayload = (occ.payload ?? {}) as OccPayload;

  const card1 = await linkedCardForStep(admin, occ, ADS_REPORT_STEP_KEY);
  if (!card1) return false; // espera a Automação 1

  const card2 = await linkedCardForStep(admin, occ, FEEDBACK_STEP_KEY);
  if (!card2?.completed_at) return false;

  // GATE DA CASCATA: só GERAR o relatório de conversão espera a revisão FINAL
  // do relatório de anúncios (o PDF de vendas usa o snapshot final). O card
  // Feedback em si já nasceu acima, independente disso. Sem revisor
  // configurado a geração já nasce final, então o ritmo de quem não usa
  // revisão não muda.
  let traffic = await currentTrafficReport(admin, card1.id);
  if (!traffic || !trafficReportIsFinal(traffic, card1)) return false;
  if (traffic.status !== "finalized") {
    traffic = await finalizeTrafficReport(admin, traffic, finalizationMoment(traffic, card1));
  }

  // Feedback e Revisão são uma conversa única para o Relatório 2. Uma correção
  // parcial no card de conversão atualiza apenas o que foi citado e mantém os
  // demais dados consolidados do card de Feedback.
  let card3 = await linkedCardForStep(admin, occ, CONVERSION_REPORT_STEP_KEY);
  if (!card3) return false;
  // Uma aprovação sem comentário humano no próprio relatório é terminal. Um
  // revisor que efetivamente escreva uma correção continua podendo abrir uma
  // nova versão, cujo fingerprint não colide com a anterior.
  if (card3.completed_at && !humanComments([card3]).length) return false;
  const ext = await consolidateAdaptiveFeedback(humanComments([card2, card3]), tags);
  if (occPayload.adaptive_source_fingerprint === ext.interpretation.sourceFingerprint) return false;

  // O período REPORTADO (não a data em que a automação rodou) é o eixo da série
  // temporal em `task_metrics` — é o que deixa "seguidores ao longo do tempo" e
  // o comparativo com a semana anterior ficarem de pé mesmo quando um
  // comentário corrigido regera tudo dias depois. Calculado uma vez aqui e
  // passado adiante pro PDF, em vez de recomputado lá dentro.
  const cadence: RecurringCadence = mold.recurrence_cadence ?? "semanal";
  // O vencimento do pai pode ser estendido até o prazo do Feedback. A série e
  // ambos os PDFs precisam usar o dia original da ocorrência.
  const occurrenceDay = typeof occ.payload?.occurrence_date === "string" ? occ.payload.occurrence_date : occ.due_date ?? today;
  const period = reportPeriodFor(cadence, occurrenceDay);

  // O que o feedback trouxe, contado num lugar só (lib/reports/conversionMode.ts)
  // — o mesmo modo e a mesma cobertura de atribuição que o PDF desenha.
  const metrics = metricsParaBanco(ext.valores, tags);
  if (ext.seguidoresGanho != null) {
    // Ganho e snapshot do perfil podem coexistir: "47 novos" seguido de
    // "7.953 para 8.000" preserva tanto o total quanto o ritmo semanal.
    if (ext.valores.seguidores == null) delete metrics.seguidores;
    metrics.seguidores_novos = String(ext.seguidoresGanho);
    if (ext.seguidoresGanhoAnterior != null) metrics.seguidores_novos_anterior = String(ext.seguidoresGanhoAnterior);
  }
  const informed = {
    vendas: ext.valores.vendas ?? null,
    agendamentos: ext.valores.agendamentos ?? null,
    receita: ext.valores.receita ?? null,
    seguidores: ext.valores.seguidores ?? null,
    seguidoresGanho: ext.seguidoresGanho ?? null,
  };
  const mode = conversionModeOf(informed, ext.linhas);
  const sourceCommentAt = ext.sourceCommentAt;

  // A interpretação é gravada antes da renderização. Assim uma falha do PDF
  // não apaga a decisão do agente nem as evidências que a sustentaram.
  const snapshot = await recordConversionInterpretationSnapshot(admin, {
    trafficReportId: traffic.id,
    feedbackTaskId: card2.id,
    conversionTaskId: card3.id,
    sourceFingerprint: ext.interpretation.sourceFingerprint,
    interpretation: ext.interpretation as unknown as Record<string, unknown>,
    metrics,
    parser: ext.note,
  });

  // Reivindica ANTES de qualquer escrita, com chave única por (etapa de
  // feedback, revisão do tráfego, comentário): retry de worker, cron em dobro ou
  // o hook de comentário correndo junto com o cron batem aqui em vez de anexar
  // um segundo PDF.
  const claim = await claimConversionReport(admin, {
    trafficReportId: traffic.id,
    feedbackTaskId: card2.id,
    sourceCommentAt,
    mode,
    metrics,
    attribution: attributionOf(informed.vendas, ext.linhas),
    parser: ext.note,
    sourceFingerprint: ext.interpretation.sourceFingerprint,
    interpretation: ext.interpretation as unknown as Record<string, unknown>,
    interpretationSnapshotId: snapshot.id,
  });
  if (!claim) return false;

  const occurrenceKey = `${occ.id}:${ext.interpretation.sourceFingerprint}`;
  const { data: runRows, error: runError } = await admin.rpc("claim_automation_run", {
    p_config_id: config.id,
    p_occurrence_key: occurrenceKey,
    p_scheduled_for: `${occ.due_date ?? today}T11:00:00.000Z`,
    p_action: "conversion_report",
    p_occurrence_id: occ.id,
  });
  if (runError) {
    await releaseConversionReport(admin, claim.id);
    throw runError;
  }
  let automationRunId = (runRows?.[0] as { id?: string } | undefined)?.id ?? null;
  if (!automationRunId) {
    // Um run marcado como succeeded pode ter ficado sem PDF depois de uma
    // limpeza/rollback (Storage e Postgres são recursos separados). Se a
    // reivindicação do relatório é nova, reutilizamos esse run como retry em
    // vez de abandonar a reivindicação correta.
    const { data: staleRows, error: staleError } = await admin.from("automation_runs")
      .select("id,status").eq("config_id", config.id).eq("occurrence_key", occurrenceKey).eq("action", "conversion_report").limit(1);
    if (staleError) throw staleError;
    const stale = staleRows?.[0] as { id?: string; status?: string } | undefined;
    if (stale?.id && stale.status === "succeeded") {
      const { error: reopenError } = await admin.from("automation_runs").update({ status: "running", started_at: nowIso(), finished_at: null, last_error: null }).eq("id", stale.id);
      if (reopenError) throw reopenError;
      automationRunId = stale.id;
    } else {
      await releaseConversionReport(admin, claim.id);
      return false;
    }
  }

  let conversionTaskId: string | null = null;
  try {
    // task_metrics — só as tags que o gestor realmente informou (ver metricsParaBanco).
    // Fluxo de EXEMPLO (molde com payload.report_example) não entra na série: os
    // números dele são ilustrativos e apareceriam como resultado real do cliente
    // na tela de Performance e no comparativo da semana seguinte.
    const isExample = (mold.payload as Record<string, unknown> | null)?.report_example === true;
    if (!isExample) {
      const { error: metricsErr } = await admin.from("task_metrics").upsert(
        { task_id: card2.id, client_id: occ.client_id, metrics, source: "cliente", period_from: period.from, period_to: period.to },
        { onConflict: "task_id" },
      );
      if (metricsErr) throw metricsErr;
      await recordFollowerSnapshots(admin, {
        clientId: occ.client_id!,
        taskId: card2.id,
        periodFrom: period.from,
        periodTo: period.to,
        current: ext.valores.seguidores ?? null,
        previous: ext.valoresAnteriores?.seguidores ?? null,
        sourceCommentAt,
      });
    }

    const sourceAt = sourceCommentAt ?? card2.completed_at;
    const ganhoComparativo = ext.seguidoresGanho != null && ext.seguidoresGanhoAnterior != null
      ? ` Comparação de seguidores novos: ${ext.seguidoresGanho} contra ${ext.seguidoresGanhoAnterior} (${ext.seguidoresGanho - ext.seguidoresGanhoAnterior >= 0 ? "+" : ""}${ext.seguidoresGanho - ext.seguidoresGanhoAnterior}; ${ext.seguidoresGanhoAnterior === 0 ? "sem base percentual" : `${((ext.seguidoresGanho - ext.seguidoresGanhoAnterior) / ext.seguidoresGanhoAnterior * 100).toFixed(2).replace(".", ",")}%`}).`
      : "";
    const precisions = [...new Set(ext.interpretation.claims.map((claim) => claim.precision).filter((precision) => precision !== "exata"))];
    const contextNote = ext.interpretation.context.length
      ? ` Contexto considerado: ${ext.interpretation.context.map((item) => item.text).join(" · ")}.`
      : "";
    const tradeoffNote = ext.interpretation.tradeoffs.length
      ? ` Decisão e trade-off: ${ext.interpretation.tradeoffs.join(" ")}`
      : "";
    const decision = ext.interpretation.decision.replace(/[.]+$/, "");
    const resumo = `North IA consolidou o período — ${resumoDe(ext.valores, tags)}.${ganhoComparativo} ${decision}.${precisions.length ? ` Valores ${precisions.join(" e ")} foram mantidos com essa etiqueta no relatório.` : ""}${contextNote}${tradeoffNote}${ext.problemas?.length ? ` Pontos não interpretados: ${ext.problemas.join("; ")}.` : ""}`;

    // Pai: só os marcadores estruturais (sem comentário — invisível). O status do
    // pai NUNCA é escrito aqui: ele é a projeção da etapa aberta (o banco recusa
    // escrita direta — trigger tasks_reject_manual_rollup_status) e acompanha o
    // card de conversão sozinho. O marcador entra por patch atômico: o pai pode
    // ter recebido comentário ou outro marcador desde que `occ` foi lido.
    const marked = await updateTaskPayload(admin, occ.id, { patch: { feedback_source_at: sourceAt } });
    occ = marked?.task ?? occ;

    conversionTaskId = card3.id;
    await updateTaskPayload(admin, card3.id, {
      text: resumo,
      commentId: automationCommentId("conversion-summary", card3.id, claim.id),
    });
    const started = await transitionTaskStatus(admin, card3.id, {
      to: "em_producao",
      from: ["backlog", "parada", "em_producao", "revisao", "aprovado", "aprovacao"],
      extra: { assignee: AUTOMATION_ASSIGNEE },
    });
    if (!started) throw new Error("A etapa Relatório de conversão mudou de estado durante o processamento.");
    card3 = (await getAdminTask(admin, card3.id)) ?? card3;
    const documentId = await generateSalesReport(admin, config, occ, card3, ext, traffic, cadence, period, sourceCommentAt, ext.interpretation.sourceFingerprint, claim.id);
    await attachConversionDocument(admin, claim.id, documentId);
    await supersedePriorConversionReports(admin, {
      id: claim.id,
      trafficReportId: traffic.id,
      feedbackTaskId: card2.id,
    });
    // A Entrega passa a Revisão sozinha, projetada desta etapa.
    await transitionTaskStatus(admin, card3.id, { to: "revisao", from: ["em_producao"] });

    await updateTaskPayload(admin, occ.id, {
      patch: { conversion_report_generated_at: nowIso(), adaptive_source_fingerprint: ext.interpretation.sourceFingerprint },
    });
  } catch (error) {
    // Sem isto a reivindicação ficaria órfã e bloquearia o retry do mesmo
    // comentário para sempre.
    await releaseConversionReport(admin, claim.id);
    await admin.from("automation_runs").update({
      status: "failed",
      last_error: errorMessage(error),
      finished_at: nowIso(),
    }).eq("id", automationRunId);
    throw error;
  }

  const { error: finishRunError } = await admin.from("automation_runs").update({
    status: "succeeded",
    last_error: null,
    finished_at: nowIso(),
  }).eq("id", automationRunId);
  if (finishRunError) throw finishRunError;

  logReportRun({
    report_type: "conversion",
    automation_id: config.id,
    client_id: occ.client_id,
    task_id: conversionTaskId,
    period: `${period.from}..${period.to}`,
    revision: traffic.revision,
    mode,
    parser: ext.note,
    llm_used: ext.note === "llm",
    source_comment_at: sourceCommentAt,
    status: "generated",
    duration_ms: Date.now() - startedAt,
  });

  const conversionId = conversionTaskId!;
  await notifyFromAutomation(admin, conversionId, "task_commented", "Automação anexou o relatório de conversão.");
  await notifyResponsibilityHolders(admin, conversionId, "gestor_trafego", "task_commented", "Relatório de conversão pronto.");
  return true;
}

export async function runConversionFlow(
  admin: AdminClient,
  config: AutomationConfigRow,
  today: string,
): Promise<RunOutcome> {
  // A dependência é declarada, não deduzida. Sem ela esta automação não sabe de
  // qual relatório de anúncios ela é a continuação — e diz isso, em vez de rodar
  // em silêncio sobre o que achar no card.
  if (!config.depends_on_config_id) {
    return { error: "Relatório de vendas sem dependência declarada: registre o Relatório de anúncios para o mesmo cliente e salve de novo." };
  }
  const mold = await getAdminTask(admin, config.target_task_id);
  if (!mold || !mold.recurrence_cadence || recurrenceStopped(mold.status)) return "not_due";

  const occs = await openOccurrences(admin, mold.id);
  let didSomething = false;

  for (const occ of occs) {
    try {
      if (await processOccurrence(admin, config, mold, occ, today)) didSomething = true;
    } catch (error) {
      const message = errorMessage(error);
      await markTaskParada(admin, occ.id, `Falha ao processar o feedback da semana: ${message}`);
      return { error: message };
    }
  }

  return didSomething ? "ran" : "not_due";
}

/** Executa a conversão depois da aprovação manual do Feedback. */
export async function processConversionFeedback(admin: AdminClient, occId: string): Promise<void> {
  const occ = await getAdminTask(admin, occId);
  if (!occ) return;
  const moldId = (occ.payload as Record<string, unknown>)?.recurrence_parent_id;
  if (typeof moldId !== "string") return;
  const { data } = await admin
    .from("automation_configs")
    .select("*")
    .eq("target_task_id", moldId)
    .eq("automation_key", "relatorio_conversao")
    .eq("active", true)
    .limit(1);
  const config = data?.[0] as AutomationConfigRow | undefined;
  if (!config?.depends_on_config_id) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;

  const today = new Date().toISOString().slice(0, 10);
  try {
    await processOccurrence(admin, config, mold, occ, today);
  } catch (error) {
    await markTaskParada(admin, occId, `Falha ao processar o feedback da semana: ${errorMessage(error)}`);
  }
}

/** Comentário direto na etapa de conversão pede uma nova versão do PDF.
 * Feedback continua sendo a fonte das métricas; esta etapa só reaproveita o
 * comentário editorial já escrito no relatório para disparar o mesmo fluxo
 * idempotente do cron, sem duplicar documento nem exigir aprovação novamente. */
export async function handleConversionRevisionComment(admin: AdminClient, taskId: string): Promise<void> {
  const card = await getAdminTask(admin, taskId);
  if (!card || card.subtype !== CONVERSION_REPORT_STEP_KEY) return;
  const { data, error } = await admin.from("task_links")
    .select("parent_id")
    .eq("child_id", taskId)
    .eq("relation_kind", "workflow_step")
    .limit(1);
  if (error) throw error;
  const occurrenceId = (data?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (occurrenceId) await processConversionFeedback(admin, occurrenceId);
}

/**
 * Comentários de Feedback alimentam a série temporal imediatamente, inclusive
 * se a etapa falhar depois. Eles não aprovam o card: aprovar ou devolver para
 * produção continua uma decisão humana genérica do revisor na interface.
 */
export async function feedbackMetricApprovalProblem(admin: AdminClient, taskId: string): Promise<string | null> {
  const card = await getAdminTask(admin, taskId);
  if (!card || card.subtype !== FEEDBACK_STEP_KEY) return null;
  const { data: linkRows, error: linkError } = await admin.from("task_links")
    .select("parent_id").eq("child_id", card.id).eq("relation_kind", "workflow_step").limit(1);
  if (linkError) throw linkError;
  const occurrenceId = (linkRows?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!occurrenceId) return "O Feedback não está vinculado à entrega da automação.";
  const occurrence = await getAdminTask(admin, occurrenceId);
  const moldId = typeof occurrence?.payload?.recurrence_parent_id === "string" ? occurrence.payload.recurrence_parent_id : null;
  if (!moldId) return "Não encontrei a configuração desta automação.";
  const { data: configRows, error: configError } = await admin.from("automation_configs").select("*")
    .eq("target_task_id", moldId).eq("automation_key", "relatorio_conversao").eq("active", true).limit(1);
  if (configError) throw configError;
  const config = configRows?.[0] as AutomationConfigRow | undefined;
  if (!config) return "A automação de relatório de conversão não está ativa.";
  const comment = [...commentsOf(card.payload)].reverse().find((item) => !AUTOMATION_AUTHORS.has(item.author));
  if (!comment) return `Antes de aprovar, informe pelo menos uma métrica. ${pedidoDe(tagsOf(config))}`;
  const parsed = await consolidateAdaptiveFeedback(humanComments([card]), tagsOf(config));
  const hasMetric = Object.values(parsed.valores).some((value) => value !== null) || parsed.linhas.length > 0 || parsed.seguidoresGanho != null;
  return hasMetric ? null : `Não consegui identificar uma métrica no último comentário. ${pedidoDe(tagsOf(config))}`;
}

export async function recordFeedbackMetricComment(admin: AdminClient, taskId: string): Promise<void> {
  const card = await getAdminTask(admin, taskId);
  if (!card || card.subtype !== FEEDBACK_STEP_KEY) return;
  const { data: linkRows, error: linkError } = await admin.from("task_links")
    .select("parent_id").eq("child_id", card.id).eq("relation_kind", "workflow_step").limit(1);
  if (linkError) throw linkError;
  const occurrenceId = (linkRows?.[0] as { parent_id?: string } | undefined)?.parent_id;
  if (!occurrenceId) return;
  const occurrence = await getAdminTask(admin, occurrenceId);
  const moldId = typeof occurrence?.payload?.recurrence_parent_id === "string" ? occurrence.payload.recurrence_parent_id : null;
  if (!occurrence || !moldId) return;
  const { data: configRows, error: configError } = await admin.from("automation_configs").select("*")
    .eq("target_task_id", moldId).eq("automation_key", "relatorio_conversao").eq("active", true).limit(1);
  if (configError) throw configError;
  const config = configRows?.[0] as AutomationConfigRow | undefined;
  if (!config) return;
  const comment = [...commentsOf(card.payload)].reverse().find((item) => !AUTOMATION_AUTHORS.has(item.author));
  if (!comment) return;
  const parsed = await consolidateAdaptiveFeedback(humanComments([card]), tagsOf(config));
  const hasMetric = Object.values(parsed.valores).some((value) => value !== null) || parsed.linhas.length > 0;
  if (!hasMetric) {
    const marker = (card.payload as Record<string, unknown> | null)?.feedback_format_warned_for;
    if (marker !== comment.at) {
      // `extractMetrics` acima pode chamar um modelo (segundos): o aviso entra
      // por UPDATE atômico, não regravando o payload lido antes dessa espera.
      await updateTaskPayload(admin, card.id, {
        text: `Não consegui identificar uma métrica. ${pedidoDe(tagsOf(config))}`,
        commentId: automationCommentId("feedback-format", card.id, comment.at),
        patch: { feedback_format_warned_for: comment.at },
      });
    }
    return;
  }
  const previousFollowerGain = parsed.seguidoresGanhoAnterior ?? null;
  if (parsed.seguidoresGanho != null && previousFollowerGain != null) {
    const difference = parsed.seguidoresGanho - previousFollowerGain;
    const percentage = previousFollowerGain === 0 ? null : (difference / previousFollowerGain) * 100;
    await updateTaskPayload(admin, card.id, {
      text: `Relatório da métrica: ${parsed.seguidoresGanho} seguidores novos; diferença de ${difference >= 0 ? "+" : ""}${difference}${percentage == null ? "" : ` (${percentage >= 0 ? "+" : ""}${percentage.toFixed(2).replace(".", ",")}%)`} em relação aos ${previousFollowerGain} anteriores.`,
      commentId: automationCommentId("feedback-metric-comparison", card.id, comment.at),
      patch: { feedback_followers_gain: parsed.seguidoresGanho, feedback_followers_gain_previous: previousFollowerGain, feedback_format_warned_for: null },
    });
  } else if (parsed.seguidoresGanho != null) {
    await updateTaskPayload(admin, card.id, {
      text: `Relatório da métrica: +${parsed.seguidoresGanho} seguidores novos.`,
      commentId: automationCommentId("feedback-metric", card.id, comment.at),
      patch: { feedback_followers_gain: parsed.seguidoresGanho, feedback_format_warned_for: null },
    });
  } else if (parsed.valoresAnteriores?.seguidores != null && parsed.valores.seguidores != null) {
    const anterior = parsed.valoresAnteriores.seguidores;
    const atual = parsed.valores.seguidores;
    const diferenca = atual - anterior;
    const porcentagem = anterior === 0 ? null : (diferenca / anterior) * 100;
    await updateTaskPayload(admin, card.id, {
      text: `Relatório da métrica: ${atual} seguidores (${diferenca >= 0 ? "+" : ""}${diferenca}${porcentagem == null ? "" : `; ${porcentagem >= 0 ? "+" : ""}${porcentagem.toFixed(2).replace(".", ",")}%`}).`,
      commentId: automationCommentId("feedback-metric", card.id, comment.at),
    });
  }
  if (!occurrence.client_id) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;
  const occurrenceDay = typeof occurrence.payload?.occurrence_date === "string"
    ? occurrence.payload.occurrence_date
    : occurrence.due_date ?? agencyToday();
  const period = reportPeriodFor(mold.recurrence_cadence ?? "semanal", occurrenceDay);
  await recordFollowerSnapshots(admin, {
    clientId: occurrence.client_id,
    taskId: card.id,
    periodFrom: period.from,
    periodTo: period.to,
    current: parsed.valores.seguidores ?? null,
    previous: parsed.valoresAnteriores?.seguidores ?? null,
    sourceCommentAt: parsed.sourceCommentAt ?? comment.at,
  });

  // Feedback vÃ¡lido Ã© a decisÃ£o do revisor: sai de Entrada e fica publicado
  // automaticamente. A cascata canÃ´nica materializa a etapa de conversÃ£o e
  // chama a geraÃ§Ã£o do primeiro PDF; um comentÃ¡rio posterior reabre somente a
  // conversÃ£o para revisÃ£o e gera a nova versÃ£o.
  const completed = await transitionTaskStatus(admin, card.id, {
    to: "aprovado",
    from: ["backlog", "em_producao", "revisao"],
    open: true,
  });
  if (completed) {
    const { advanceFlowAfterUpdate } = await import("@/lib/flows/advance");
    await advanceFlowAfterUpdate(card, completed);
  } else {
    const conversion = await linkedCardForStep(admin, occurrence, CONVERSION_REPORT_STEP_KEY);
    if (conversion && conversion.status !== "revisao" && !conversion.completed_at) {
      await transitionTaskStatus(admin, conversion.id, {
        to: "revisao",
        from: ["backlog", "em_producao", "aprovacao"],
      });
    } else if (conversion?.completed_at || conversion?.status === "aprovacao") {
      await transitionTaskStatus(admin, conversion.id, {
        to: "revisao",
        from: ["aprovado", "aprovacao"],
      });
    }
    await processConversionFeedback(admin, occurrenceId);
  }
}
