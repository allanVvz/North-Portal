// Registro estruturado das duas pipelines de relatório — `traffic_reports` e
// `conversion_reports` (migração 20260915000000). Ver
// docs/reporting/report-pipeline.md.
//
// O PDF é output. O que aqui se grava é a fonte de verdade: de qual revisão,
// a partir de que dados, e sobre qual revisão FINAL do relatório de anúncios o
// relatório de vendas foi gerado.
//
// A primeira metade do arquivo é pura (testável sem banco); a segunda é a
// leitura/escrita.

import type { Period } from "@/app/admin/performance/insights";
import type { MetaPost } from "@/lib/windsor";
import type { TaskRecord } from "@/lib/validation";
import type { Attribution, ConversionMode } from "@/lib/reports/conversionMode";
import type { AdminClient } from "./taskAccess";
import type { StoredPreview } from "./creativeAssets";
import type { TrafficFinalView } from "@/lib/reports/adsReportPdf";

export type TrafficSnapshot = {
  campaignPosts: MetaPost[];
  prevCampaignPosts: MetaPost[];
  adPosts: MetaPost[];
  /** Anúncios da semana anterior — destaques que comparam semanas. */
  prevAdPosts?: MetaPost[];
  /** Por adId: miniatura guardada no storage e link do post (creativeAssets.ts). */
  previews?: Record<string, StoredPreview>;
  /** Final editorial view consumed by the conversion report. */
  trafficFinalView?: TrafficFinalView;
};

export type TrafficReportStatus = "generated" | "finalized" | "superseded";

export type TrafficReportRow = {
  id: string;
  client_id: string;
  task_id: string;
  occurrence_id: string | null;
  period_from: string;
  period_to: string;
  revision: number;
  snapshot: TrafficSnapshot;
  status: TrafficReportStatus;
  document_id: string | null;
  generated_at: string;
  finalized_at: string | null;
};

export type ConversionInterpretationSnapshot = {
  id: string;
  scope_key: string;
  source_fingerprint: string;
};

const TRAFFIC_COLUMNS = "id,client_id,task_id,occurrence_id,period_from,period_to,revision,snapshot,status,document_id,generated_at,finalized_at";

// ---- puro --------------------------------------------------------------------

/**
 * A Automação 2 só trabalha sobre a revisão FINAL do relatório de anúncios.
 *
 * Final é: marcado como finalizado; OU a etapa não tem revisor (não há revisão
 * humana a esperar — a geração é a versão final); OU a etapa já foi aprovada.
 * Uma revisão substituída nunca é final, mesmo que tenha sido um dia.
 */
export function trafficReportIsFinal(
  report: Pick<TrafficReportRow, "status">,
  step: Pick<TaskRecord, "reviewer_id" | "completed_at">,
): boolean {
  if (report.status === "superseded") return false;
  if (report.status === "finalized") return true;
  return !step.reviewer_id || Boolean(step.completed_at);
}

/** O momento em que a revisão virou final. Com revisor, é a APROVAÇÃO da etapa —
 *  não o instante em que a automação percebeu, que pode ser um dia depois e
 *  deixaria de fora comentários feitos nesse intervalo. */
export function finalizationMoment(
  report: Pick<TrafficReportRow, "finalized_at" | "generated_at">,
  step: Pick<TaskRecord, "reviewer_id" | "completed_at">,
): string {
  return report.finalized_at ?? (step.reviewer_id ? step.completed_at ?? report.generated_at : report.generated_at);
}

/** Revisão 1 mantém o nome histórico; as seguintes ganham sufixo. */
export function trafficReportFileName(periodTo: string, revision: number): string {
  return revision <= 1 ? `relatorio-trafego-${periodTo}.pdf` : `relatorio-trafego-${periodTo}-r${revision}.pdf`;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** `at` depois de `since`, comparando INSTANTES. Os carimbos de comentário vêm
 *  em dois formatos (RPC do Postgres e `toISOString` do JS) e comparar como
 *  string ordena errado. Sem `since`, tudo conta. */
export function isAfter(at: string, since: string | null | undefined): boolean {
  const s = ms(since);
  if (s === null) return true;
  const a = ms(at);
  return a !== null && a > s;
}

/** O mais recente dos dois limites — o que vier por último fecha a janela. */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = ms(a);
  const tb = ms(b);
  if (ta === null) return tb === null ? null : (b as string);
  if (tb === null) return a as string;
  return ta >= tb ? (a as string) : (b as string);
}

// ---- banco: traffic_reports --------------------------------------------------

export async function nextTrafficRevision(admin: AdminClient, taskId: string): Promise<number> {
  const { data, error } = await admin
    .from("traffic_reports")
    .select("revision")
    .eq("task_id", taskId)
    .order("revision", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = (data?.[0] as { revision: number } | undefined)?.revision ?? 0;
  return last + 1;
}

export async function recordTrafficReport(
  admin: AdminClient,
  input: {
    clientId: string;
    taskId: string;
    occurrenceId: string | null;
    period: Period;
    revision: number;
    snapshot: TrafficSnapshot;
    documentId: string | null;
    /** Preenchido quando a geração já é final (sem revisor). */
    finalizedAt: string | null;
  },
): Promise<TrafficReportRow> {
  const { data, error } = await admin
    .from("traffic_reports")
    .insert({
      client_id: input.clientId,
      task_id: input.taskId,
      occurrence_id: input.occurrenceId,
      period_from: input.period.from,
      period_to: input.period.to,
      revision: input.revision,
      snapshot: input.snapshot,
      document_id: input.documentId,
      status: input.finalizedAt ? "finalized" : "generated",
      finalized_at: input.finalizedAt,
    })
    .select(TRAFFIC_COLUMNS)
    .limit(1);
  if (error) throw error;
  // Uma revisão nova tira as anteriores de circulação: a Automação 2 nunca pode
  // trabalhar sobre uma revisão obsoleta.
  const { error: supersedeError } = await admin
    .from("traffic_reports")
    .update({ status: "superseded" })
    .eq("task_id", input.taskId)
    .lt("revision", input.revision)
    .neq("status", "superseded");
  if (supersedeError) throw supersedeError;
  return data![0] as unknown as TrafficReportRow;
}

/** A revisão vigente (a mais alta não substituída) do relatório de anúncios de
 *  uma etapa. */
export async function currentTrafficReport(admin: AdminClient, taskId: string): Promise<TrafficReportRow | null> {
  const { data, error } = await admin
    .from("traffic_reports")
    .select(TRAFFIC_COLUMNS)
    .eq("task_id", taskId)
    .neq("status", "superseded")
    .order("revision", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as unknown as TrafficReportRow | undefined) ?? null;
}

/** Idempotente: só muda linha que ainda está `generated`. */
export async function finalizeTrafficReport(admin: AdminClient, report: TrafficReportRow, at: string): Promise<TrafficReportRow> {
  if (report.status === "finalized") return report;
  const { data, error } = await admin
    .from("traffic_reports")
    .update({ status: "finalized", finalized_at: at })
    .eq("id", report.id)
    .eq("status", "generated")
    .select(TRAFFIC_COLUMNS)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as unknown as TrafficReportRow | undefined) ?? { ...report, status: "finalized", finalized_at: at };
}

// ---- banco: conversion_reports -----------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

/**
 * Reivindica a geração do relatório de vendas para (etapa de feedback, revisão
 * do tráfego, comentário). Devolve `null` quando outra execução já reivindicou —
 * retry, cron em dobro ou o hook de comentário correndo junto com o cron.
 */
export async function claimConversionReport(
  admin: AdminClient,
  input: {
    trafficReportId: string;
    feedbackTaskId: string;
    sourceCommentAt: string | null;
    mode: ConversionMode;
    metrics: Record<string, string>;
    attribution: Attribution;
    parser: string;
    sourceFingerprint: string;
    interpretation: Record<string, unknown>;
    interpretationSnapshotId: string | null;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("conversion_reports")
    .insert({
      traffic_report_id: input.trafficReportId,
      feedback_task_id: input.feedbackTaskId,
      source_comment_at: input.sourceCommentAt,
      mode: input.mode,
      conversion_metrics: input.metrics,
      attribution: input.attribution,
      parser: input.parser,
      source_fingerprint: input.sourceFingerprint,
      interpretation: input.interpretation,
      interpretation_snapshot_id: input.interpretationSnapshotId,
    })
    .select("id")
    .limit(1);
  if (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
  return data![0] as { id: string };
}

/**
 * Registro append-only do entendimento que antecede a renderização. A mesma
 * impressão digital pode aparecer em retries, mas nunca ganha outro snapshot.
 */
export async function recordConversionInterpretationSnapshot(
  admin: AdminClient,
  input: {
    trafficReportId: string;
    feedbackTaskId: string;
    conversionTaskId: string | null;
    sourceFingerprint: string;
    interpretation: Record<string, unknown>;
    metrics: Record<string, string>;
    parser: string;
  },
): Promise<ConversionInterpretationSnapshot> {
  const scopeKey = `${input.trafficReportId}:${input.feedbackTaskId}`;
  const { data, error } = await admin
    .from("conversion_report_snapshots")
    .insert({
      traffic_report_id: input.trafficReportId,
      feedback_task_id: input.feedbackTaskId,
      conversion_task_id: input.conversionTaskId,
      scope_key: scopeKey,
      source_fingerprint: input.sourceFingerprint,
      interpretation: input.interpretation,
      conversion_metrics: input.metrics,
      parser: input.parser,
    })
    .select("id,scope_key,source_fingerprint")
    .limit(1);
  if (!error) return data![0] as ConversionInterpretationSnapshot;
  if (!isUniqueViolation(error)) throw error;
  const { data: existing, error: existingError } = await admin
    .from("conversion_report_snapshots")
    .select("id,scope_key,source_fingerprint")
    .eq("scope_key", scopeKey)
    .eq("source_fingerprint", input.sourceFingerprint)
    .limit(1);
  if (existingError) throw existingError;
  if (!existing?.[0]) throw error;
  return existing[0] as ConversionInterpretationSnapshot;
}

export async function attachConversionDocument(admin: AdminClient, id: string, documentId: string | null): Promise<void> {
  const { error } = await admin.from("conversion_reports").update({ document_id: documentId }).eq("id", id);
  if (error) throw error;
}

/** Once the new artifact exists, retire only previous versions over the same
 * finalized ads report and feedback card.  The rows and their documents stay
 * intact for audit/history; readers use the non-superseded version. */
export async function supersedePriorConversionReports(
  admin: AdminClient,
  input: { id: string; trafficReportId: string; feedbackTaskId: string },
): Promise<void> {
  const { error } = await admin.from("conversion_reports")
    .update({ status: "superseded" })
    .eq("traffic_report_id", input.trafficReportId)
    .eq("feedback_task_id", input.feedbackTaskId)
    .neq("id", input.id)
    .neq("status", "superseded");
  if (error) throw error;
}

/** Desfaz a reivindicação quando a geração falhou, para o retry não ficar
 *  bloqueado por um registro sem PDF. */
export async function releaseConversionReport(admin: AdminClient, id: string): Promise<void> {
  await admin.from("conversion_reports").delete().eq("id", id);
}
