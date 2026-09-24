import { createHash } from "node:crypto";
import type { TaskComment } from "@/lib/comments";
import { extractMetrics, type ConversionRow, type MetricExtract } from "./extractMetrics";
import { extractReportInstructions } from "@/lib/reports/reportInstructions";

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

/** Limite de "Leitura da semana": o mesmo teto que o PDF já aplica à narrativa
 *  (`narrativePlan.maxChars`, 560). */
export const READING_MAX_CHARS = 560;

/** O texto que a operação escreveu, pronto para o CLIENTE ler.
 *
 *  Não é `evidence()`. Aquele é um trecho de AUDITORIA — fica ao lado de cada
 *  métrica extraída para mostrar de onde ela veio, e cortar em 280 no meio da
 *  palavra ali não faz mal a ninguém. Usado para o texto que vai ao cliente, ele
 *  fez a CRIS receber (24/09) "...com as promoções com intuito de trazer até…"
 *  — a Luiza tinha escrito 291 caracteres, e os 11 cortados eram "a loja
 *  física", que era o ponto da frase.
 *
 *  Texto que cabe no teto sai inteiro. O que passa é cortado no último fim de
 *  frase antes do teto — nunca no meio de uma — e só cai para o limite de
 *  palavra quando não há frase terminada nenhuma antes dele. */
export function readingText(text: string, max = READING_MAX_CHARS): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  const janela = compact.slice(0, max);
  const fimDeFrase = Math.max(janela.lastIndexOf(". "), janela.lastIndexOf("! "), janela.lastIndexOf("? "));
  // Frase inteira só quando sobra texto de verdade: cortar em "Ok. " e jogar fora
  // 500 caracteres seria pior que o corte por palavra.
  if (fimDeFrase >= max * 0.4) return compact.slice(0, fimDeFrase + 1);
  const fimDePalavra = janela.lastIndexOf(" ");
  return `${compact.slice(0, fimDePalavra > 0 ? fimDePalavra : max).trimEnd()}…`;
}

/** Extrai somente a leitura editorial que a operação escreveu junto aos números.
 * Métricas continuam no fluxo estruturado; o PDF não deve repetir o resumo todo. */
function operationalAnalysis(text: string): string | null {
  const compact = text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const explicit = /(?:an[aá]lise\s+(?:geral|da\s+semana)?|leitura\s+da\s+semana)\s*[:\-]?\s*([\s\S]*?)(?=\s*(?:📌|resumo\s+geral)\b|$)/i.exec(compact)?.[1]?.trim();
  const source = explicit || compact;
  const editorialSentences = source
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /aten[cç][aã]o|foco|estrat[eé]g|objetivo|prioriz|dividid|trabalhando|enquanto/i.test(sentence))
    .slice(0, 2)
    .join(" ");
  const candidate = editorialSentences || (explicit ? source.split(/(?<=[.!?])\s+/).at(0) ?? "" : "");
  if (!candidate) return null;
  return readingText(candidate);
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
  let custoPorNovoSeguidor: number | null = null;
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
    if (parsed.custoPorNovoSeguidor != null) {
      custoPorNovoSeguidor = parsed.custoPorNovoSeguidor;
      claims.set("custo_por_novo_seguidor", {
        metric: "custo_por_novo_seguidor", value: custoPorNovoSeguidor,
        precision, confidence, sourceCommentAt: comment.at, sourceTaskId: comment.taskId, evidence: evidence(comment.text),
      });
    }
    if (parsed.linhas.length) linhas = parsed.linhas;
    // "Ajuste o comentário: X" já vira a narrativa do PDF em outro lugar
    // (reportInstructions.ts/conversionFlow.ts), limpa e sem o prefixo. Sem
    // este pulo, o mesmo texto caía cru aqui TAMBÉM e "Leitura da semana"
    // mostrava a mesma frase duas vezes — uma certa, uma com "Ajuste o
    // comentário:" grudado (achado real na CRIS, 22/09).
    const jaVirouNarrativa = extractReportInstructions(comment.text).instrucoes.some((i) => i.kind === "narrativa");
    const analysis = operationalAnalysis(comment.text);
    if (jaVirouNarrativa) {
      // nada — a narrativa cobre este comentário sozinha.
    } else if (analysis) {
      context.push({ sourceCommentAt: comment.at, sourceTaskId: comment.taskId, author: comment.author, text: analysis });
    } else if ((intent === "contexto" || intent === "misto" || (!metricPresent && intent !== "regeneracao")) && comment.text.trim()) {
      context.push({ sourceCommentAt: comment.at, sourceTaskId: comment.taskId, author: comment.author, text: readingText(comment.text) });
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
    custoPorNovoSeguidor,
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
