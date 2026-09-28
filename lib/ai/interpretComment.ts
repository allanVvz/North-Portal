// Lê UM comentário da equipe numa Entrega de relatório (texto livre, escrito
// no card-pai ou em qualquer etapa) e devolve o que ele quer dizer, num formato
// só: dados da semana, correções ao relatório, leitura, pedido visual,
// aprovação, pergunta.
//
// Por que existe (28/09/2026): a interpretação estava espalhada em regex
// independentes — `classifyVisualComment`, `extractReportInstructions`,
// `parseFeedbackComment` — cada uma olhando uma parte do texto e ignorando o
// resto. A Luiza escrevia como se fala ("Incluir crescimento de 114 novo
// seguidores nos dados do funil", "alcance corrigir para 12.452. Substituir as
// frases de leitura da semana por essas: …") e cada regex entendia um pedaço,
// ou nenhum.
//
// Como funciona:
//   1. Uma chamada à IA com saída em JSON Schema (`aiComplete` + `jsonSchema`).
//   2. Guarda-corpos determinísticos: todo número tem de estar escrito no texto,
//      a leitura tem de ser trecho literal do comentário, objetivo e alvo só de
//      listas fechadas. Campo reprovado é descartado.
//   3. O extrator determinístico (as regex acima) roda sempre. Ele preenche o
//      que a IA não trouxe ou trouxe inválido, e é a resposta inteira quando a
//      IA não está configurada ou falha.
//
// NUNCA lança: sem IA, com IA fora do ar ou com resposta ilegível, devolve o
// resultado determinístico.

import { aiComplete, type JsonSchemaFormat } from "./complete";
import { parseAmount, parseFeedbackComment } from "./commentParser";
import { extractReportInstructions, type HideTarget } from "@/lib/reports/reportInstructions";
import type { CampaignBlock } from "@/lib/performanceTemplates";

export type InterpretStep = "feedback" | "relatorio_conversao" | "relatorio_anuncios" | "outro";

export type InterpretContext = {
  /** Etapa onde o comentário foi gravado. */
  step: InterpretStep;
  /** Métricas de conversão que o cliente acompanha (tags da automação). */
  tags: string[];
};

export type VisualTarget = "funnel" | "table" | "first_page" | "ads" | "unknown";

export type TeamCommentIntent = {
  /** Um valor por tag citada. Seguidores fica fora: tem os dois campos abaixo. */
  metrics: Record<string, number>;
  /** Ganho da semana ("114 novos seguidores", "seguidores novos: 39"). */
  seguidoresNovos: number | null;
  /** Total do perfil ("seguidores: 30,9 mil", "perfil com 9078"). */
  seguidoresTotal: number | null;
  /** Correção de alcance: total e/ou por objetivo. */
  reach: { total: number | null; byObjective: Partial<Record<CampaignBlock, number>> };
  /** A leitura da semana que deve ir para o cliente, literal. */
  narrative: string | null;
  hide: HideTarget[];
  /** Defeito de layout no PDF. `target: "unknown"` = falta dizer onde. */
  visual: { target: VisualTarget; instruction: string } | null;
  /** Aprovação explícita ("aprovado", "pode gerar"). */
  approval: boolean;
  /** Pergunta que pede resposta de uma pessoa. */
  question: string | null;
  /** Pedidos que nenhuma regra soube aplicar. */
  notUnderstood: string[];
  /** Há algo que o fluxo sabe usar: dado, leitura, correção, aprovação. */
  useful: boolean;
  source: "ia" | "regras" | "ia+regras";
};

const OBJECTIVES: CampaignBlock[] = ["trafego_site", "trafego_perfil", "mensagens", "engajamento"];
const HIDE_TARGETS: HideTarget[] = ["percentual_comparativo", "compras", "alcance", "impressoes", "cliques"];
const VISUAL_TARGETS: VisualTarget[] = ["funnel", "table", "first_page", "ads", "unknown"];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const squash = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------------------------------------------------------------------------
// Guarda-corpos
// ---------------------------------------------------------------------------

/** Todos os números que o texto de fato escreve, nas leituras possíveis:
 *  "12.452" → 12452; "30,9 mil" → 30900; "6311" → 6311; "R$ 1.200,50" → 1200.5. */
export function numbersInText(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(\d[\d.,]*)(\s*(?:mil|k)\b)?/gi)) {
    const raw = m[1].replace(/[.,]$/, "");
    const mult = m[2] ? 1000 : 1;
    const candidates = [parseAmount(raw), Number(raw.replace(/\D/g, ""))];
    for (const c of candidates) {
      if (c !== null && Number.isFinite(c)) out.add(Math.round(c * mult * 100) / 100);
    }
  }
  return out;
}

function numberOk(n: unknown, allowed: Set<number>): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && allowed.has(Math.round(n * 100) / 100);
}

const HIDE_EVIDENCE: Record<HideTarget, RegExp> = {
  percentual_comparativo: /%|percentu|porcentag|comparativ|anterior/,
  compras: /compra/,
  alcance: /alcance/,
  impressoes: /impress/,
  cliques: /clique/,
};
const REMOVAL = /\b(?:nao|nem|sem|remov\w*|retir\w*|tir\w*|exclu\w*|ocult\w*|escond\w*|apag\w*)\b/;

/** Esconder só vale com pedido de remoção e o alvo citados na MESMA frase.
 *  No eval de 28/09 o modelo leu "alcance corrigir para 12.452" como "esconder
 *  o alcance" — o PDF sairia sem o número que a pessoa acabou de corrigir. */
function hideOk(target: HideTarget, text: string): boolean {
  return fold(text).split(/[.;\n!?]+/).some((frase) => REMOVAL.test(frase) && HIDE_EVIDENCE[target].test(frase));
}

/** A leitura tem de ser o que a pessoa escreveu — a IA não redige texto para o
 *  cliente. Comparação sem acento, caixa e pontuação. */
function narrativeOk(narrative: unknown, text: string): narrative is string {
  if (typeof narrative !== "string") return false;
  const n = squash(narrative);
  return n.length >= 12 && squash(text).includes(n);
}

// ---------------------------------------------------------------------------
// Regras (determinístico)
// ---------------------------------------------------------------------------

const VISUAL_DEFECT = /\b(sobrep\w*|invad\w*|cortad\w*|encost\w*|desalinh\w*|vazad\w*|estourad\w*|feio|horr[ií]vel|n[aã]o ficou bom)/i;
const APPROVAL = /^\s*(?:ok[,.! ]*)?(?:aprovad[oa]|aprovo|pode (?:gerar|enviar|seguir|publicar)|t[aá] (?:certo|ok|aprovado)|tudo certo)\b/i;

function visualTargetOf(text: string): VisualTarget {
  const t = fold(text);
  if (/funil|ultimo nivel/.test(t)) return "funnel";
  if (/tabela/.test(t)) return "table";
  if (/primeira pagina|leitura do periodo|capa/.test(t)) return "first_page";
  if (/anuncio|midia|grafico|criativo/.test(t)) return "ads";
  return "unknown";
}

/** Formas de ganho que o parser de métricas não cobre (28/09): "seguidores
 *  novos:39" (rótulo composto) e "sendo 65 frutos das campanhas". */
const GANHO_ROTULO = /\bseguidores?\s+(?:novos|ganhos|a mais)\s*[:=\-]?\s*\+?\s*(\d[\d.,]*)/i;
const GANHO_FRUTO = /(\d[\d.,]*)\s+(?:novos?\s+)?(?:seguidores\s+)?(?:frutos?|vindos?|ganhos?|conquistados?)\b/i;
/** "seguidores: 30,9 mil" — o parser lê 30,9 e ignora o "mil". */
const TOTAL_MIL = /\bseguidores?\s*[:=\-]?\s*(\d[\d.,]*)\s*(?:mil|k)\b/i;

/** Leitura sem rótulo: no Feedback, um parágrafo de análise sem número de
 *  conversão nem pedido é a leitura da semana (Karpinski, 28/09: "Nesta semana
 *  direcionamos a atenção para público engajado…"). Curto demais é conversa. */
function looksLikeReading(text: string): boolean {
  const t = text.trim();
  return t.length >= 80 && t.split(/\s+/).length >= 12 && !t.endsWith("?");
}

export function interpretByRules(text: string, ctx: InterpretContext): TeamCommentIntent {
  const instr = extractReportInstructions(text);
  const parsed = parseFeedbackComment(text, ctx.tags);
  const metrics: Record<string, number> = {};
  for (const [tag, value] of Object.entries(parsed.valores)) {
    if (tag !== "seguidores" && typeof value === "number") metrics[tag] = value;
  }
  const ganhoExtra = GANHO_ROTULO.exec(text) ?? GANHO_FRUTO.exec(text);
  const novos = parsed.seguidoresGanho ?? (ganhoExtra ? parseAmount(ganhoExtra[1]) : null);
  const mil = TOTAL_MIL.exec(text);
  const totalRaw = mil ? (parseAmount(mil[1]) ?? 0) * 1000 : parsed.valores.seguidores;
  const total = typeof totalRaw === "number" && totalRaw !== novos ? totalRaw : null;
  const alcance = instr.instrucoes.find((i) => i.kind === "alcance");
  const narrativa = instr.instrucoes.find((i) => i.kind === "narrativa");
  const trimmed = text.trim();
  const intent: TeamCommentIntent = {
    metrics,
    seguidoresNovos: novos,
    seguidoresTotal: total,
    reach: alcance?.kind === "alcance"
      ? { total: alcance.valor, byObjective: alcance.porObjetivo ?? {} }
      : { total: null, byObjective: {} },
    narrative: narrativa?.kind === "narrativa"
      ? narrativa.texto
      : ctx.step === "feedback" && !instr.instrucoes.length && !Object.keys(metrics).length && novos === null && looksLikeReading(text)
        ? text.trim().replace(/\s+/g, " ")
        : null,
    hide: instr.instrucoes.flatMap((i) => (i.kind === "esconder" ? [i.alvo] : [])),
    visual: VISUAL_DEFECT.test(trimmed) ? { target: visualTargetOf(trimmed), instruction: trimmed } : null,
    approval: APPROVAL.test(trimmed),
    question: trimmed.endsWith("?") ? trimmed : null,
    notUnderstood: instr.naoEntendido,
    useful: false,
    source: "regras",
  };
  intent.useful = isUseful(intent);
  return intent;
}

function isUseful(i: TeamCommentIntent): boolean {
  return Object.keys(i.metrics).length > 0
    || i.seguidoresNovos !== null
    || i.seguidoresTotal !== null
    || i.reach.total !== null
    || Object.keys(i.reach.byObjective).length > 0
    || i.narrative !== null
    || i.hide.length > 0
    || i.visual !== null
    || i.approval;
}

// ---------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------

const nullableNumber = { type: ["number", "null"] };

export const INTENT_SCHEMA: JsonSchemaFormat = {
  name: "team_comment_intent",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["metrics", "seguidoresNovos", "seguidoresTotal", "reachTotal", "reachByObjective", "narrative", "hide", "visual", "approval", "question", "notUnderstood"],
    properties: {
      metrics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tag", "value"],
          properties: { tag: { type: "string" }, value: { type: "number" } },
        },
      },
      seguidoresNovos: nullableNumber,
      seguidoresTotal: nullableNumber,
      reachTotal: nullableNumber,
      reachByObjective: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["objective", "value"],
          properties: { objective: { type: "string", enum: OBJECTIVES }, value: { type: "number" } },
        },
      },
      narrative: { type: ["string", "null"] },
      hide: { type: "array", items: { type: "string", enum: HIDE_TARGETS } },
      visual: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["target", "instruction"],
            properties: { target: { type: "string", enum: VISUAL_TARGETS }, instruction: { type: "string" } },
          },
        ],
      },
      approval: { type: "boolean" },
      question: { type: ["string", "null"] },
      notUnderstood: { type: "array", items: { type: "string" } },
    },
  },
};

function systemPrompt(ctx: InterpretContext): string {
  return [
    "Você lê comentários da equipe de uma agência sobre o relatório semanal de tráfego pago de um cliente e devolve o que o comentário quer dizer, no schema pedido.",
    "O fluxo tem 3 etapas: Relatório de anúncios (gerado e aprovado automaticamente), Feedback (a equipe informa os dados e a leitura da semana) e Relatório de conversão (o relatório corrigido que vai para o cliente). Todo pedido de correção vale para o relatório de conversão desta semana.",
    `Etapa onde o comentário foi escrito: ${ctx.step}.`,
    `Métricas que este cliente acompanha (use exatamente estas tags em metrics): ${ctx.tags.filter((t) => t !== "seguidores").join(", ") || "nenhuma"}.`,
    "Regras:",
    "- Nunca invente número: todo número que você devolver tem de estar escrito no comentário. \"30,9 mil\" = 30900; \"12.452\" = 12452.",
    "- Seguidores: ganho da semana (\"114 novos seguidores\", \"seguidores novos: 39\", \"65 frutos das campanhas\") vai em seguidoresNovos; total do perfil (\"seguidores: 30,9 mil\", \"seguidores 9078\") vai em seguidoresTotal. Nunca coloque seguidores em metrics.",
    "- Alcance corrigido (\"alcance correto 9307\", \"corrija o alcance: total 6311\") vai em reachTotal; alcance por campanha (\"8425 da campanha de tráfego pro perfil\") vai em reachByObjective (trafego_perfil, trafego_site, mensagens, engajamento).",
    "- narrative: SOMENTE quando o comentário traz um texto de análise/leitura da semana para o cliente ler. Copie o trecho LITERALMENTE, sem reescrever, sem o rótulo (\"Leitura da semana:\") e sem as instruções que vierem junto. Se não houver, null.",
    "- Corrigir um número NÃO é esconder: \"alcance corrigir para 12.452\" é reachTotal, nunca hide alcance.",
    "- hide: o que o comentário pede para NÃO mostrar: percentual_comparativo (qualquer % ou comparação com a semana anterior), compras (número de compras e custo por compra), alcance, impressoes, cliques.",
    "- visual: só quando o comentário aponta DEFEITO DE LAYOUT no PDF (texto sobrepondo, cortado, invadindo, desalinhado, feio). target = onde (funnel, table, first_page, ads) ou unknown se não disser. Números, leitura ou pedidos de conteúdo NÃO são visual.",
    "- approval: true só se o comentário aprova explicitamente (\"aprovado\", \"pode gerar\", \"tudo certo\").",
    "- question: se o comentário é uma pergunta para alguém da equipe, copie a pergunta; senão null.",
    "- notUnderstood: pedidos ao relatório que não cabem em nenhum campo acima, com as palavras da pessoa. Não repita aqui o que já entrou em outro campo.",
  ].join("\n");
}

type RawIntent = {
  metrics?: { tag?: unknown; value?: unknown }[];
  seguidoresNovos?: unknown;
  seguidoresTotal?: unknown;
  reachTotal?: unknown;
  reachByObjective?: { objective?: unknown; value?: unknown }[];
  narrative?: unknown;
  hide?: unknown[];
  visual?: { target?: unknown; instruction?: unknown } | null;
  approval?: unknown;
  question?: unknown;
  notUnderstood?: unknown[];
};

/** Aplica os guarda-corpos sobre a resposta da IA e completa com as regras.
 *  Exportada para os testes: é a parte que decide o que a IA pode afirmar. */
export function mergeValidated(raw: RawIntent, text: string, ctx: InterpretContext, rules: TeamCommentIntent): TeamCommentIntent {
  const allowed = numbersInText(text);
  const metrics: Record<string, number> = { ...rules.metrics };
  for (const m of raw.metrics ?? []) {
    if (typeof m.tag === "string" && ctx.tags.includes(m.tag) && m.tag !== "seguidores" && numberOk(m.value, allowed)) metrics[m.tag] = m.value;
  }
  const byObjective: Partial<Record<CampaignBlock, number>> = { ...rules.reach.byObjective };
  for (const r of raw.reachByObjective ?? []) {
    if (OBJECTIVES.includes(r.objective as CampaignBlock) && numberOk(r.value, allowed)) byObjective[r.objective as CampaignBlock] = r.value;
  }
  const hide = [...new Set([...rules.hide, ...(raw.hide ?? []).filter((h): h is HideTarget => HIDE_TARGETS.includes(h as HideTarget) && hideOk(h as HideTarget, text))])];
  const visual = raw.visual && VISUAL_TARGETS.includes(raw.visual.target as VisualTarget)
    ? { target: raw.visual.target as VisualTarget, instruction: typeof raw.visual.instruction === "string" && raw.visual.instruction.trim() ? raw.visual.instruction.trim() : text.trim() }
    : rules.visual;
  const intent: TeamCommentIntent = {
    metrics,
    seguidoresNovos: numberOk(raw.seguidoresNovos, allowed) ? raw.seguidoresNovos : rules.seguidoresNovos,
    seguidoresTotal: numberOk(raw.seguidoresTotal, allowed) ? raw.seguidoresTotal : rules.seguidoresTotal,
    reach: { total: numberOk(raw.reachTotal, allowed) ? raw.reachTotal : rules.reach.total, byObjective },
    narrative: narrativeOk(raw.narrative, text) ? raw.narrative.trim() : rules.narrative,
    hide,
    visual,
    approval: raw.approval === true || rules.approval,
    question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim() : rules.question,
    // O que as regras não entenderam e a IA resolveu não é mais "não entendido".
    notUnderstood: (raw.notUnderstood ?? []).filter((s): s is string => typeof s === "string" && s.trim().length > 3).map((s) => s.trim()),
    useful: false,
    source: "ia+regras",
  };
  // Mesmo valor dos dois lados não é "total": é o ganho dito uma vez só.
  if (intent.seguidoresTotal !== null && intent.seguidoresTotal === intent.seguidoresNovos) intent.seguidoresTotal = null;
  intent.useful = isUseful(intent);
  return intent;
}

export type InterpretDeps = {
  complete?: typeof aiComplete;
};

export async function interpretComment(text: string, ctx: InterpretContext, deps: InterpretDeps = {}): Promise<TeamCommentIntent> {
  const rules = interpretByRules(text, ctx);
  if (!text.trim()) return rules;
  const complete = deps.complete ?? aiComplete;
  try {
    const answer = await complete({
      system: systemPrompt(ctx),
      user: text,
      maxTokens: 900,
      model: process.env.OPENAI_INTERPRET_MODEL?.trim() || undefined,
      jsonSchema: INTENT_SCHEMA,
    });
    const raw = JSON.parse(answer) as RawIntent;
    return mergeValidated(raw, text, ctx, rules);
  } catch {
    return rules;
  }
}

/** Frase curta do que foi entendido, para o eco no card. */
export function describeIntent(i: TeamCommentIntent): string[] {
  const out: string[] = [];
  if (i.seguidoresNovos !== null) out.push(`+${i.seguidoresNovos.toLocaleString("pt-BR")} seguidores novos`);
  if (i.seguidoresTotal !== null) out.push(`${i.seguidoresTotal.toLocaleString("pt-BR")} seguidores no perfil`);
  for (const [tag, value] of Object.entries(i.metrics)) out.push(`${tag}: ${value.toLocaleString("pt-BR")}`);
  if (i.reach.total !== null) out.push(`alcance ${i.reach.total.toLocaleString("pt-BR")}`);
  for (const [obj, value] of Object.entries(i.reach.byObjective)) out.push(`alcance de ${obj.replace("_", " ")} ${value!.toLocaleString("pt-BR")}`);
  if (i.narrative) out.push("leitura da semana");
  for (const h of i.hide) out.push(`esconder ${h.replace("_", " ")}`);
  return out;
}
