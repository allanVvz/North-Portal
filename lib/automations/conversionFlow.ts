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
// Não filtra por due_date — reage ao comentário em qualquer dia, mas SÓ depois
// que o relatório de anúncios da mesma ocorrência está na revisão final
// (`traffic_reports`), e só lê comentários posteriores a ela. A mídia vem do
// snapshot daquela revisão, nunca de uma segunda busca na API.
//
// Idempotência em duas camadas: marcadores no payload (feedback_prompt_at /
// feedback_source_at / sales_report_generated_at) decidem se há algo novo; a
// reivindicação em `conversion_reports` (chave única por etapa + revisão do
// tráfego + comentário) impede duas execuções simultâneas de gerarem dois PDFs.
// Também é chamada pontualmente pelo hook de comentário
// (processConversionFeedback), fora do cron. Ver docs/reporting/report-pipeline.md.

import { DOCUMENT_BUCKET, documentStoragePath } from "@/lib/documentFiles";
import { RECURRENCE_CADENCE_LABEL } from "@/lib/automationCatalog";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { commentsOf, type TaskComment } from "@/lib/comments";
import { flowStepTaskId } from "@/lib/flows/ids";
import { ensureFlowStep, settleTypelessFlow } from "@/lib/flows/advance";
import { recurrenceStopped } from "@/lib/recurrenceState";
import type { Period } from "@/app/admin/performance/insights";
import { extractMetrics, type ConversionRow, type MetricExtract } from "@/lib/ai/extractMetrics";
import { feedbackTemplate } from "@/lib/ai/commentParser";
import { CONVERSION_METRICS_DEFAULT, metricTagLabel, needsRichExtraction } from "@/lib/metricTags";
import { renderSalesReportPdf, type SalesPrevTotals } from "@/lib/reports/salesReportPdf";
import type { RecurringCadence, TaskRecord } from "@/lib/validation";
import { markTaskParada } from "./errorHandling";
import { loadStoredPreviews } from "./creativeAssets";
import { appendedCommentPayload, asTaskRecord, errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
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
  isAfter,
  laterOf,
  releaseConversionReport,
  trafficReportIsFinal,
  type TrafficReportRow,
} from "./reportEntities";
import { logReportRun } from "./reportLog";
import type { AutomationConfigRow, RunOutcome } from "./run";

const AUTOMATION_AUTHORS = new Set(["Automação", AUTOMATION_ASSIGNEE]);

// A Automação 2 não depende mais de um provedor de IA: o pedido de feedback traz
// um modelo, lido pelo parser determinístico (lib/ai/commentParser.ts). Antes ela
// ficava dormente sem IA — e, com a chave da OpenAI cadastrada mas a organização
// não verificada, acordava para chamar um modelo que devolvia 404. A IA virou um
// fallback opcional (`COMMENT_AI_FALLBACK=1`, ver extractMetrics.ts).
const FEEDBACK_LEAD_DAYS = 2;   // prazo do card de feedback = vencimento da ocorrência + 2
const TOLERANCIA_DIAS = 3;      // dias após o prazo antes de fechar com zeros

type OccPayload = Record<string, unknown> & {
  feedback_prompt_at?: string;
  feedback_source_at?: string;
  sales_report_generated_at?: string;
  /** `at` do comentário fora do modelo que já recebeu o pedido de correção. */
  feedback_format_warned_for?: string;
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

/** Resposta a um comentário que o parser não conseguiu ler. */
function pedidoDeCorrecao(tags: string[], ext: MetricExtract): string {
  const motivo = ext.problemas?.length ? ` (${ext.problemas.join("; ")})` : "";
  return [
    `Não consegui ler os números deste comentário${motivo}. Pode reenviar no modelo? Uma informação por linha:`,
    "",
    feedbackTemplate(tags),
  ].join("\n");
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

/** O comentário humano mais recente, em qualquer um dos cards, mais novo que `since`. */
function latestHumanComment(cards: TaskRecord[], since: string | null): (TaskComment & { taskId: string }) | null {
  const all = cards.flatMap((c) => commentsOf(c.payload).map((cm) => ({ ...cm, taskId: c.id })));
  // Instantes, não strings: `at` vem em dois formatos (RPC e JS) e comparar
  // como texto ordena errado entre eles.
  const human = all
    .filter((c) => !AUTOMATION_AUTHORS.has(c.author) && isAfter(c.at, since))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
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
    return { periodTo: row.period_to, vendas: read("vendas"), agendamentos: read("agendamentos"), receita: read("receita"), seguidores: read("seguidores") };
  });
}

async function generateSalesReport(
  admin: AdminClient,
  config: AutomationConfigRow,
  occ: TaskRecord,
  card2: TaskRecord,
  ext: MetricExtract,
  traffic: TrafficReportRow,
  cadence: RecurringCadence,
  period: Period,
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
  const { campaignPosts = [], prevCampaignPosts = [], adPosts = [], prevAdPosts = [], previews: storedPreviews } = traffic.snapshot ?? {};
  const templateConfig = await resolveTemplateConfig(admin, config.performance_template_id);
  const conversoes: ConversionRow[] = ext.linhas;
  const [prevTotals, history, previews] = await Promise.all([
    previousPeriodTotals(admin, clientId, period.from),
    conversionHistory(admin, clientId, period.to),
    loadStoredPreviews(admin, storedPreviews),
  ]);

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
    seguidores: typeof ext.valores.seguidores === "number" ? ext.valores.seguidores : null,
    prevTotals,
    history,
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
  if (docError) throw docError;

  const fresh = (await getAdminTask(admin, card2.id))?.payload ?? card2.payload;
  const { error: updErr } = await admin
    .from("tasks")
    .update({ payload: appendedCommentPayload(fresh, `Relatório de vendas gerado e anexado: [${fileName}](${urlData.publicUrl})`) })
    .eq("id", card2.id);
  if (updErr) throw updErr;
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
  let occPayload = (occ.payload ?? {}) as OccPayload;

  let card1 = await getAdminTask(admin, flowStepTaskId(occ.id, "trafego"));
  if (!card1) return false; // espera a Automação 1

  // GATE DA CASCATA: esta pipeline só trabalha sobre a revisão FINAL do
  // relatório de anúncios. Antes bastava o PDF existir, e um comentário feito
  // enquanto o humano ainda revisava o tráfego já disparava o relatório de
  // vendas (auditoria, A1). Sem revisor configurado a geração já nasce final,
  // então o ritmo de quem não usa revisão não muda.
  let traffic = await currentTrafficReport(admin, card1.id);
  if (!traffic || !trafficReportIsFinal(traffic, card1)) return false;
  if (traffic.status !== "finalized") {
    traffic = await finalizeTrafficReport(admin, traffic, finalizationMoment(traffic, card1));
  }

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
  // O gestor comenta os números na etapa `trafego` (ou na `feedback` se já
  // existe) — mas só conta o que foi dito DEPOIS da revisão final: com revisor,
  // o que se comenta na etapa de tráfego antes da aprovação é revisão do
  // relatório, não o feedback da semana.
  const since = laterOf(traffic.finalized_at, occPayload.feedback_source_at);
  const human = latestHumanComment([card1, ...(card2 ? [card2] : [])], since);

  const agendDue = addDays(occ.due_date ?? today, FEEDBACK_LEAD_DAYS);
  const overdue = today >= addDays(agendDue, TOLERANCIA_DIAS);
  if (!human && !overdue) return true; // ainda dentro do prazo, esperando
  if (occPayload.sales_report_generated_at && !human) return false; // já fechado, sem novidade

  const ext: MetricExtract = human
    ? await extractMetrics(human.text, tags)
    // Sem retorno é o caso mais claro de "não informado": ninguém disse que a
    // semana foi zero — ninguém disse nada.
    : { valores: Object.fromEntries(tags.map((t) => [t, null])), linhas: [], note: "sem retorno do responsável" };

  // O gestor respondeu, mas fora do modelo, e o parser não leu: responde no mesmo
  // card com o modelo (uma vez por comentário) e segue esperando. Fechar a semana
  // como "não informado" diria que ninguém respondeu. Passado o prazo e a
  // tolerância, fecha como antes.
  if (human && !overdue && (ext.note === "formato não reconhecido" || ext.note === "comentário ambíguo")) {
    if (occPayload.feedback_format_warned_for === human.at) return false;
    const commented = await getAdminTask(admin, human.taskId);
    if (commented) {
      const { error: warnErr } = await admin
        .from("tasks")
        .update({ payload: appendedCommentPayload(commented.payload, pedidoDeCorrecao(tags, ext)) })
        .eq("id", commented.id);
      if (warnErr) throw warnErr;
    }
    occPayload = { ...occPayload, feedback_format_warned_for: human.at };
    const { error: occWarnErr } = await admin.from("tasks").update({ payload: occPayload }).eq("id", occ.id);
    if (occWarnErr) throw occWarnErr;
    return true;
  }

  if (!card2) {
    card2 = await ensureFlowStep(admin, occ, "feedback", { title: "Feedback da semana", leadDays: FEEDBACK_LEAD_DAYS, clientVisible: true, position: 20 }, today);
  }

  // O período REPORTADO (não a data em que a automação rodou) é o eixo da série
  // temporal em `task_metrics` — é o que deixa "seguidores ao longo do tempo" e
  // o comparativo com a semana anterior ficarem de pé mesmo quando um
  // comentário corrigido regera tudo dias depois. Calculado uma vez aqui e
  // passado adiante pro PDF, em vez de recomputado lá dentro.
  const cadence: RecurringCadence = mold.recurrence_cadence ?? "semanal";
  const period = reportPeriodFor(cadence, occ.due_date ?? today);

  // O que o feedback trouxe, contado num lugar só (lib/reports/conversionMode.ts)
  // — o mesmo modo e a mesma cobertura de atribuição que o PDF desenha.
  const metrics = metricsParaBanco(ext.valores, tags);
  const informed = {
    vendas: ext.valores.vendas ?? null,
    agendamentos: ext.valores.agendamentos ?? null,
    receita: ext.valores.receita ?? null,
    seguidores: ext.valores.seguidores ?? null,
  };
  const mode = conversionModeOf(informed, ext.linhas);
  const sourceCommentAt = human?.at ?? null;

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
  });
  if (!claim) return false;

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
    }

    const sourceAt = sourceCommentAt ?? nowIso();
    const resumo = human
      ? `Registrei o feedback da semana — ${resumoDe(ext.valores, tags)}.${ext.problemas?.length ? ` Deixei de fora: ${ext.problemas.join("; ")}.` : ""}`
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
    const documentId = await generateSalesReport(admin, config, occ, card2, ext, traffic, cadence, period);
    await attachConversionDocument(admin, claim.id, documentId);

    const { error: markErr } = await admin
      .from("tasks")
      .update({ payload: { ...((await getAdminTask(admin, occ.id))?.payload ?? {}), sales_report_generated_at: nowIso() } })
      .eq("id", occ.id);
    if (markErr) throw markErr;
  } catch (error) {
    // Sem isto a reivindicação ficaria órfã e bloquearia o retry do mesmo
    // comentário para sempre.
    await releaseConversionReport(admin, claim.id);
    throw error;
  }

  logReportRun({
    report_type: "conversion",
    automation_id: config.id,
    client_id: occ.client_id,
    task_id: card2.id,
    period: `${period.from}..${period.to}`,
    revision: traffic.revision,
    mode,
    parser: ext.note,
    llm_used: ext.note === "llm",
    source_comment_at: sourceCommentAt,
    status: "generated",
    duration_ms: Date.now() - startedAt,
  });

  await notifyFromAutomation(admin, card2.id, "task_commented", `Automação anexou o relatório de vendas em "${card2.title}".`);
  await notifyResponsibilityHolders(admin, card2.id, "gestor_trafego", "task_commented", `Relatório de vendas pronto em "${card2.title}".`);
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
    return { error: "Relatório de vendas sem dependência declarada: registre o Relatório de anúncios no mesmo card e salve de novo." };
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
  if (!config?.depends_on_config_id) return;
  const mold = await getAdminTask(admin, moldId);
  if (!mold) return;

  const today = new Date().toISOString().slice(0, 10);
  try {
    await processOccurrence(admin, config, mold, occ, today);
    await settleTypelessFlow(admin, occId).catch(() => {});
  } catch (error) {
    await markTaskParada(admin, occId, `Falha ao processar o feedback da semana: ${errorMessage(error)}`);
  }
}
