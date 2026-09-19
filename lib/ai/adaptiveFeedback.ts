import { createHash } from "node:crypto";
import type { TaskComment } from "@/lib/comments";
import { extractMetrics, type ConversionRow, type MetricExtract } from "./extractMetrics";

export type CommentIntent = "informacao" | "correcao" | "confirmacao" | "contexto" | "regeneracao" | "misto";
export type MetricPrecision = "exata" | "aproximada" | "faixa" | "estimada";
export type MetricConfidence = "alta" | "media" | "baixa";

export type AdaptiveClaim = {
  metric: string;
  value: number;
  previousValue?: number;
  precision: MetricPrecision;
  confidence: MetricConfidence;
  sourceCommentAt: string;
  sourceTaskId: string;
  evidence: string;
  derived?: boolean;
};

export type AdaptiveContext = {
  sourceCommentAt: string;
  sourceTaskId: string;
  author: string;
  text: string;
};

export type AdaptiveInterpretation = {
  sourceFingerprint: string;
  comments: Array<{ at: string; taskId: string; intent: CommentIntent; precision: MetricPrecision; author: string }>;
  claims: AdaptiveClaim[];
  context: AdaptiveContext[];
  decision: string;
  tradeoffs: string[];
};

export type AdaptiveMetricExtract = MetricExtract & {
  interpretation: AdaptiveInterpretation;
  sourceCommentAt: string | null;
};

export type SourcedComment = TaskComment & { taskId: string };

const APPROXIMATE = /(?:\b(?:cerca\s+de|aproximadamente|aprox\.?|por volta de|uns?|umas?)\b|~)/i;
const RANGE = /\bentre\s+\d[\d.,]*\s+(?:e|a)\s+\d[\d.,]*/i;
const ESTIMATED = /\b(?:estimad[oa]s?|estimativa|proje[cç][aã]o)\b/i;
const CORRECTION = /\b(?:corrig(?:ir|indo|ido|ida)|corre[cç][aã]o|nao\s+eram|não\s+eram|em\s+vez\s+de|ajust(?:e|ando|ado)|atualiz(?:e|ando|ado))\b/i;
const CONFIRMATION = /\b(?:confirm(?:o|ado|ada)|isso\s+mesmo|pode\s+manter|est[aá]\s+certo)\b/i;
const REGENERATE = /\b(?:gere|gerar|regenere|regerar|novo\s+relat[oó]rio|nova\s+vers[aã]o|atualize\s+o\s+pdf)\b/i;
const CONTEXT = /\b(?:foco|objetivo|evento|alcance|campanha|porque|por[ée]m|mas|contexto|prioriz)/i;

function stamp(comment: SourcedComment) {
  return `${comment.taskId}|${comment.id ?? ""}|${comment.at}|${comment.edited_at ?? ""}|${comment.text.trim()}`;
}

export function fingerprintComments(comments: readonly SourcedComment[]): string {
  const source = [...comments]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map(stamp)
    .join("\n");
  return createHash("sha256").update(source).digest("hex");
}

export function intentOf(text: string): CommentIntent {
  const hits = [CORRECTION.test(text), CONFIRMATION.test(text), REGENERATE.test(text), CONTEXT.test(text)].filter(Boolean).length;
  if (hits > 1) return "misto";
  if (CORRECTION.test(text)) return "correcao";
  if (CONFIRMATION.test(text)) return "confirmacao";
  if (REGENERATE.test(text)) return "regeneracao";
  if (CONTEXT.test(text)) return "contexto";
  return "informacao";
}

export function precisionOf(text: string): MetricPrecision {
  if (RANGE.test(text)) return "faixa";
  if (ESTIMATED.test(text)) return "estimada";
  return APPROXIMATE.test(text) ? "aproximada" : "exata";
}

function confidenceOf(extract: MetricExtract, precision: MetricPrecision): MetricConfidence {
  if (precision !== "exata" || extract.note.includes("ambíguo") || extract.note.includes("ambigua")) return "baixa";
  return extract.note === "parser" ? "alta" : "media";
}

function hasMetrics(extract: MetricExtract): boolean {
  return Object.values(extract.valores).some((value) => value !== null)
    || Object.values(extract.valoresAnteriores ?? {}).some((value) => value !== null)
    || extract.linhas.length > 0
    || extract.seguidoresGanho != null
    || extract.seguidoresGanhoAnterior != null;
}

function mergeValues(target: Record<string, number | null>, incoming: Record<string, number | null> | undefined) {
  for (const [key, value] of Object.entries(incoming ?? {})) if (value !== null && value !== undefined) target[key] = value;
}

function evidence(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 280 ? `${compact.slice(0, 277)}…` : compact;
}

/**
 * Consolida o thread humano do Feedback e da Revisão. Cada comentário só muda
 * o que declara: correções parciais preservam valores anteriores e todos os
 * valores finais carregam a evidência de onde vieram.
 */
export async function consolidateAdaptiveFeedback(comments: readonly SourcedComment[], tags: string[]): Promise<AdaptiveMetricExtract> {
  const ordered = [...comments].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const valores: Record<string, number | null> = Object.fromEntries(tags.map((tag) => [tag, null]));
  const valoresAnteriores: Record<string, number | null> = Object.fromEntries(tags.map((tag) => [tag, null]));
  let linhas: ConversionRow[] = [];
  let seguidoresGanho: number | null = null;
  let seguidoresGanhoAnterior: number | null = null;
  const claims = new Map<string, AdaptiveClaim>();
  const context: AdaptiveContext[] = [];
  const tradeoffs: string[] = [];
  const notes: string[] = [];

  for (const comment of ordered) {
    const parsed = await extractMetrics(comment.text, tags);
    const intent = intentOf(comment.text);
    const precision = precisionOf(comment.text);
    const confidence = confidenceOf(parsed, precision);
    const metricPresent = hasMetrics(parsed);
    notes.push(parsed.note);

    for (const [metric, value] of Object.entries(parsed.valores)) {
      if (value === null || value === undefined) continue;
      const prior = valores[metric];
      if (prior !== null && prior !== value && intent !== "correcao" && intent !== "confirmacao") {
        tradeoffs.push(`${metric}: usei ${value} do comentário mais recente em vez de ${prior}; a divergência ficou registrada.`);
      }
      valores[metric] = value;
      claims.set(metric, { metric, value, precision, confidence, sourceCommentAt: comment.at, sourceTaskId: comment.taskId, evidence: evidence(comment.text) });
    }
    for (const [metric, value] of Object.entries(parsed.valoresAnteriores ?? {})) {
      if (value === null || value === undefined) continue;
      valoresAnteriores[metric] = value;
      claims.set(`${metric}_anterior`, { metric, value, previousValue: value, precision, confidence, sourceCommentAt: comment.at, sourceTaskId: comment.taskId, evidence: evidence(comment.text) });
    }
    if (parsed.seguidoresGanho != null) {
      seguidoresGanho = parsed.seguidoresGanho;
      claims.set("seguidores_novos", { metric: "seguidores_novos", value: seguidoresGanho, precision, confidence, sourceCommentAt: comment.at, sourceTaskId: comment.taskId, evidence: evidence(comment.text) });
    }
    if (parsed.seguidoresGanhoAnterior != null) {
      seguidoresGanhoAnterior = parsed.seguidoresGanhoAnterior;
      claims.set("seguidores_novos_anterior", { metric: "seguidores_novos_anterior", value: seguidoresGanhoAnterior, previousValue: seguidoresGanhoAnterior, precision, confidence, sourceCommentAt: comment.at, sourceTaskId: comment.taskId, evidence: evidence(comment.text) });
    }
    if (parsed.linhas.length) linhas = parsed.linhas;
    if ((intent === "contexto" || intent === "misto" || (!metricPresent && intent !== "regeneracao")) && comment.text.trim()) {
      context.push({ sourceCommentAt: comment.at, sourceTaskId: comment.taskId, author: comment.author, text: evidence(comment.text) });
    }
  }

  const updated = [...claims.values()].map((claim) => claim.metric.replace(/_anterior$/, "")).filter((metric, index, all) => all.indexOf(metric) === index);
  const decision = updated.length
    ? `Atualizei ${updated.join(", ")} e mantive as demais métricas já registradas para o período.`
    : "Não identifiquei números novos; mantive as métricas já registradas e atualizei somente o contexto do relatório.";
  const problemNotes = notes.filter((note) => note !== "parser" && note !== "llm" && note !== "nada identificado");

  return {
    valores,
    valoresAnteriores,
    linhas,
    note: notes.includes("llm") ? "llm" : notes.length ? "parser" : "comentário vazio",
    problemas: problemNotes.length ? [...new Set(problemNotes)] : undefined,
    seguidoresGanho,
    seguidoresGanhoAnterior,
    sourceCommentAt: ordered.at(-1)?.at ?? null,
    interpretation: {
      sourceFingerprint: fingerprintComments(ordered),
      comments: ordered.map((comment) => ({ at: comment.at, taskId: comment.taskId, intent: intentOf(comment.text), precision: precisionOf(comment.text), author: comment.author })),
      claims: [...claims.values()],
      context: context.slice(-3),
      decision,
      tradeoffs: [...new Set(tradeoffs)],
    },
  };
}
