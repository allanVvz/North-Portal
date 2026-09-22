// Leitura DETERMINÍSTICA do comentário de feedback — sem IA.
//
// O pedido de feedback (lib/automations/conversionFlow.ts) traz um modelo
// (`feedbackTemplate`), e este parser lê o modelo e as variações naturais mais
// comuns: "5 vendas", "Receita R$ 4.100", "seguidores de 829 pra 841",
// "nenhuma venda". Desenho em docs/reporting/comment-parser.md.
//
// Mesmo contrato da extração por IA: `null` = não informado, `0` = informado
// como zero. O parser prefere deixar de fora a ler errado: número sem rótulo não
// vira métrica, a mesma métrica com dois valores fica de fora (AMBIGUOUS) e o
// ganho de seguidores não vira total. O que ficou de fora volta em `problemas`,
// numa frase que o gestor entende.

import { needsRichExtraction } from "@/lib/metricTags";

export type ParseState = "PARSED_OK" | "PARTIAL" | "AMBIGUOUS" | "INVALID";

/** Mesmo formato de `ConversionRow` (extractMetrics.ts), sem importar de lá. */
export type ParsedRow = {
  servico: string | null;
  valor: number | null;
  fonte: "1" | "2" | "3" | null;
  status: "agendado" | "fechado" | null;
};

export type ParsedComment = {
  state: ParseState;
  valores: Record<string, number | null>;
  valoresAnteriores: Record<string, number | null>;
  linhas: ParsedRow[];
  /** O que foi deixado de fora, em frase curta para o gestor corrigir. */
  problemas: string[];
  /** Algo que só uma leitura em linguagem natural resolveria (origem no meio da
   *  frase, ganho de seguidores sem o total). Decide o fallback de IA, quando ligado. */
  precisaIa: boolean;
  /** Ganho informado (ex.: "+47 novos"), sem tratar o ganho como total. */
  seguidoresGanho?: number | null;
  /** Ganho do período anterior quando o comentário traz uma comparação textual. */
  seguidoresGanhoAnterior?: number | null;
  /** Custo por seguidor novo informado no resumo operacional. */
  custoPorNovoSeguidor?: number | null;
};

// Rótulos já sem acento e em minúsculas (o texto é comparado dobrado).
// "orçamento", "proposta" e "cotação" contam como agendamento — mesma regra do prompt.
const LABELS: Record<string, string[]> = {
  vendas: ["vendas fechadas", "vendas", "venda", "fechamentos", "fechamento"],
  agendamentos: ["agendamentos", "agendamento", "orcamentos", "orcamento", "propostas", "proposta", "cotacoes", "cotacao"],
  receita: ["receita", "faturamento", "faturado"],
  seguidores: ["seguidores", "seguidor"],
  leads: ["leads", "lead"],
  // "orcamento" NÃO entra aqui: já é alias de `agendamentos` (orçamento enviado
  // ao cliente), e a mesma palavra nas duas listas trocaria os dois números.
  verba_disponivel: ["verba disponivel", "verba restante", "verba", "saldo de verba", "saldo"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Número em pt-BR ou simples: "4.100", "4.100,50", "4100.50", "841". */
const NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)`;

export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  let n: number;
  if (s.includes(",")) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));
  else n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function labelAlt(tag: string): string {
  const labels = (LABELS[tag] ?? [fold(tag)]).slice().sort((a, b) => b.length - a.length);
  return `(?:${labels.map(escapeRe).join("|")})`;
}

// ---- linhas de origem: "#1 PPF frontal R$ 1.200" ----------------------------------

const ORIGIN_LINE = /^\s*#\s*([123])(?!\d)\s*[-–—:.)]?\s*(.*)$/;
const MONEY_IN_ROW = new RegExp(String.raw`r\$\s*${NUM}`, "i");
const ANY_AMOUNT = new RegExp(NUM, "g");

function parseRow(fonte: "1" | "2" | "3", rest: string): ParsedRow {
  let valor: number | null = null;
  let cleaned = rest;
  const money = MONEY_IN_ROW.exec(rest);
  if (money) {
    valor = parseAmount(money[1]);
    cleaned = rest.slice(0, money.index) + " " + rest.slice(money.index + money[0].length);
  } else {
    const all = [...rest.matchAll(ANY_AMOUNT)];
    const last = all[all.length - 1];
    if (last && last.index !== undefined) {
      valor = parseAmount(last[1]);
      cleaned = rest.slice(0, last.index) + " " + rest.slice(last.index + last[0].length);
    }
  }
  const status = /agend/.test(fold(rest)) ? "agendado" : "fechado";
  const servico = cleaned
    .replace(/(^|\s)(fechad[oa]s?|vendid[oa]s?|agendad[oa]s?|venda)(?=\s|$)/gi, " ")
    .replace(/[-–—:·|,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { servico: servico ? servico.slice(0, 120) : null, valor: valor && valor > 0 ? valor : null, fonte, status };
}

// ---- trechos de métrica -------------------------------------------------------------

type Acc = { found: Map<string, number[]>; previousFound: Map<string, number[]>; problemas: string[]; precisaIa: boolean; seguidoresGanho: number | null; seguidoresGanhoAnterior: number | null };

function followerGainComparison(text: string): { previous: number; current: number } | null {
  const base = fold(text);
  const previous = /(?:periodo|semana)\s+(?:anterior|passada)[\s\S]{0,120}?([\d.,]+)\s+seguidores?\s+nov\w*/i.exec(base);
  if (!previous || previous.index === undefined) return null;
  const after = base.slice(previous.index + previous[0].length);
  if (!/(?:periodo|semana)\b/i.test(after)) return null;
  const numbers = [...after.matchAll(/\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)]
    .map((m) => parseAmount(m[0]))
    .filter((n): n is number => n !== null);
  const current = numbers.at(-1);
  return current === undefined ? null : { previous: parseAmount(previous[1]) ?? 0, current };
}

/** Snapshot do total do perfil em linguagem natural: "período anterior com
 * 7953 seguidores e atualmente com 8000 seguidores". Isso é diferente de
 * "47 seguidores novos": aqui os dois números são totais acumulados e o
 * ganho deve ser calculado pela diferença entre eles. */
function followerSnapshotComparison(text: string): { previous: number; current: number } | null {
  const base = fold(text);
  const match = /(?:periodo|semana)\s+(?:anterior|passada)[\s\S]{0,80}?(?:com\s+)?([\d.,]+)\s+seguidores?\b[\s\S]{0,80}?(?:atualmente|agora|neste\s+periodo|no\s+periodo(?:\s+atual)?)[\s\S]{0,40}?(?:com\s+)?([\d.,]+)\s+seguidores?\b/i.exec(base)
    ?? /\bseguidores?\b\s*[:=]\s*([\d.,]+)[\s\S]{0,50}?(?:na\s+)?(?:periodo|semana)\s+(?:anterior|passada)[\s\S]{0,50}?(?:atualmente|agora|neste\s+periodo|no\s+periodo(?:\s+atual)?)[\s:=-]*([\d.,]+)/i.exec(base)
    ?? /(?:tinhamos|t[ií]nhamos|estavamos|est[aá]vamos)\s+(?:com\s+|mais\s+de\s+)?([\d.,]+)\s+seguidores?\b[\s\S]{0,80}?(?:alcancamos|alcan[cç]amos|chegamos|atingimos|temos)\s+(?:a\s+)?([\d.,]+)\b/i.exec(base);
  if (!match) return null;
  const previous = parseAmount(match[1]);
  const current = parseAmount(match[2]);
  return previous === null || current === null ? null : { previous, current };
}

/** "66 novos seguidores" é ganho do período, não a base total do perfil. */
function followerGain(text: string): number | null {
  const base = fold(text);
  const match = new RegExp(String.raw`(?:\+\s*)?${NUM}\s+(?:novos?|ganhos?)\s+seguidores?\b`, "i").exec(base)
    ?? new RegExp(String.raw`\b(?:novos?|ganhos?)\s+seguidores?\s*[:=]\s*\+?\s*${NUM}`, "i").exec(base);
  return match ? parseAmount(match[1]) : null;
}

/** A base do perfil dita em texto corrido: "o perfil já estava com mais de
 *  8000", "o perfil tem 30000 seguidores".
 *
 *  Não exige a palavra "seguidores" depois do número, de propósito: os dois
 *  comentários reais que trouxeram essa frase vieram com erro de digitação
 *  justamente ali ("8000 seguidres", "mias de 30000"), e exigir a palavra
 *  fazia a base do perfil ser descartada como "número sem rótulo". */
function followerBaseTotal(text: string): number | null {
  const base = fold(text);
  const match = new RegExp(
    String.raw`\bperfil\b\s+(?:ja\s+)?(?:estava|esta|tinha|tem|contava)\s+(?:com\s+)?(?:\w+\s+de\s+)?${NUM}`,
    "i",
  ).exec(base);
  return match ? parseAmount(match[1]) : null;
}

/** A operação pode informar o custo diretamente; ele não precisa ser inferido. */
function followerCost(text: string): number | null {
  const base = fold(text).replace(/[*_`]/g, "");
  const match = new RegExp(String.raw`\bcusto\s+por\s+(?:novo\s+)?seguidor(?:es)?\s*[:=]\s*(?:r\$\s*)?${NUM}`, "i").exec(base);
  return match ? parseAmount(match[1]) : null;
}

function readChunk(original: string, tags: string[], acc: Acc) {
  const base = fold(original);
  let rest = base;
  const blank = (start: number, len: number) => {
    rest = rest.slice(0, start) + " ".repeat(len) + rest.slice(start + len);
  };
  const take = (re: RegExp, onMatch: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      blank(m.index, m[0].length);
      onMatch(m);
    }
  };
  const add = (tag: string, raw: string) => {
    const v = parseAmount(raw);
    if (v === null) return;
    const list = acc.found.get(tag) ?? [];
    list.push(v);
    acc.found.set(tag, list);
  };

  if (/#\s*[123](?!\d)/.test(rest)) {
    acc.precisaIa = true;
    acc.problemas.push(`origem no meio da frase ("${original.trim().slice(0, 40)}") — use uma linha começando com #1, #2 ou #3`);
    rest = rest.replace(/#\s*[123](?!\d)/g, (m) => " ".repeat(m.length));
  }

  // "custo por novo seguidor" contém a palavra seguidor, mas o valor é moeda,
  // não a quantidade de seguidores. A métrica é lida separadamente em
  // followerCost; retire este trecho antes do leitor genérico de seguidores.
  const followerCostMatch = new RegExp(String.raw`\bcusto\s+por\s+(?:novo\s+)?seguidor(?:es)?\s*[:=]\s*(?:\*?r\$\s*)?${NUM}`, "i").exec(rest);
  if (followerCostMatch?.index !== undefined) blank(followerCostMatch.index, followerCostMatch[0].length);

  // 1. zero dito: "nenhuma venda", "sem agendamentos"
  for (const tag of tags) {
    take(new RegExp(String.raw`\b(?:nenhum|nenhuma|zero|sem)\s+${labelAlt(tag)}\b`), () => {
      const list = acc.found.get(tag) ?? [];
      list.push(0);
      acc.found.set(tag, list);
    });
  }

  // 2. seguidores de X para Y → Y (o total ao fim da semana)
  if (tags.includes("seguidores")) {
    const L = labelAlt("seguidores");
    const TO = String.raw`\s*(?:para|pra|->|→|ate|a)\s*`;
    const addPair = (m: RegExpExecArray) => {
      const previous = parseAmount(m[1]);
      if (previous !== null) {
        const list = acc.previousFound.get("seguidores") ?? [];
        list.push(previous);
        acc.previousFound.set("seguidores", list);
      }
      add("seguidores", m[2]);
    };
    take(new RegExp(String.raw`\b${L}\b\s*[:=\-]?\s*(?:de\s+)?${NUM}${TO}${NUM}`), addPair);
    take(new RegExp(String.raw`(?:de\s+)?${NUM}${TO}${NUM}\s+(?:de\s+)?${L}\b`), addPair);
  }

  // 3. rótulo e número. A ordem do trecho decide qual lado é o rótulo de cada
  //    número: "Vendas 5 Agendamentos 8" é rótulo-número; "5 vendas 8 agendamentos"
  //    é número-rótulo. Lidos na ordem errada, os dois trocariam os valores.
  const firstLabel = Math.min(...tags.map((t) => {
    const i = rest.search(new RegExp(String.raw`\b${labelAlt(t)}\b`));
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  }));
  const firstNum = rest.search(/\d/);
  const numberFirst = firstNum >= 0 && firstNum < firstLabel;

  const handle = (tag: string, m: RegExpExecArray) => {
    if (tag === "seguidores") {
      const before = base.slice(Math.max(0, m.index - 20), m.index);
      const after = base.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if (m[1]
        || /(?:ganh\w*|nov\w*|aument\w*|cres[cç]\w*)\s*(?:uns|umas|cerca de|mais)?\s*[:=]?\s*$/.test(before)
        || /^\s*(?:novos|a mais|ganhos?)/.test(after)) {
        acc.seguidoresGanho = parseAmount(m[2]);
      }
    }
    add(tag, m[2]);
  };
  const labelFirst = (tag: string) => new RegExp(String.raw`\b${labelAlt(tag)}\b\s*[:=\-]?\s*(\+)?\s*(?:r\$\s*)?${NUM}`);
  const numFirst = (tag: string) => new RegExp(String.raw`(\+)?\s*(?:r\$\s*)?${NUM}\s+(?:de\s+|em\s+)?(?:novos?\s+|ganhos?\s+)?${labelAlt(tag)}\b`);
  for (const pass of numberFirst ? [numFirst, labelFirst] : [labelFirst, numFirst]) {
    for (const tag of tags) take(pass(tag), (m) => handle(tag, m));
  }

  if (/\d/.test(rest)) acc.problemas.push(`número sem rótulo em "${original.trim().slice(0, 48)}"`);
}

// ---- entrada -------------------------------------------------------------------------

export function parseFeedbackComment(text: string, tags: string[]): ParsedComment {
  const acc: Acc = { found: new Map(), previousFound: new Map(), problemas: [], precisaIa: false, seguidoresGanho: null, seguidoresGanhoAnterior: null };
  const gainComparison = followerGainComparison(text);
  const snapshotComparison = followerSnapshotComparison(text);
  const directFollowerGain = followerGain(text);
  const custoPorNovoSeguidor = followerCost(text);
  if (gainComparison && tags.includes("seguidores")) {
    acc.seguidoresGanho = gainComparison.current;
    acc.seguidoresGanhoAnterior = gainComparison.previous;
  }
  if (directFollowerGain !== null && tags.includes("seguidores")) acc.seguidoresGanho = directFollowerGain;
  const rich = needsRichExtraction(tags);
  const linhas: ParsedRow[] = [];

  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const origin = ORIGIN_LINE.exec(line);
    if (origin) {
      if (rich) linhas.push(parseRow(origin[1] as "1" | "2" | "3", origin[2]));
      continue;
    }
    for (const chunk of line.split(/;|,\s+|\.\s+|\s+e\s+/i)) {
      if (chunk.trim()) readChunk(chunk, tags, acc);
    }
  }

  // A snapshot comparison contains two valid values for the same metric. The
  // generic reader sees both before it knows their roles, so normalize it
  // before the ambiguity check below.
  if (snapshotComparison && tags.includes("seguidores")) {
    acc.found.set("seguidores", [snapshotComparison.current]);
    acc.previousFound.set("seguidores", [snapshotComparison.previous]);
  }

  // "21 novos seguidores. O perfil já estava com 30000": a base do perfil é o
  // valor ANTERIOR ao ganho, não um segundo valor da mesma métrica. Sem separar
  // os dois papéis, o leitor genérico via 21 e 30000 na mesma tag, marcava
  // AMBIGUOUS e descartava os dois em silêncio — foi assim que os seguidores da
  // CRIS sumiram do relatório.
  if (!snapshotComparison && tags.includes("seguidores")) {
    const baseTotal = followerBaseTotal(text);
    if (baseTotal !== null) {
      acc.previousFound.set("seguidores", [baseTotal]);
      const candidatos = (acc.found.get("seguidores") ?? []).filter((v) => v !== baseTotal);
      if (candidatos.length) acc.found.set("seguidores", candidatos);
      else acc.found.delete("seguidores");
    }
  }

  const valores: Record<string, number | null> = Object.fromEntries(tags.map((t) => [t, null]));
  const valoresAnteriores: Record<string, number | null> = Object.fromEntries(tags.map((t) => [t, null]));
  let conflito = false;
  for (const tag of tags) {
    const distinct = [...new Set(acc.found.get(tag) ?? [])];
    if (distinct.length === 1) valores[tag] = distinct[0];
    else if (distinct.length > 1) {
      conflito = true;
      acc.problemas.push(`${tag} aparece com valores diferentes (${distinct.join(" e ")})`);
    }
  }

  // Comparação textual de ganhos ("período anterior: 90 seguidores novos; neste
  // período: 47") vence os números intermediários de datas e mantém os dois
  // valores disponíveis para o relatório de revisão.
  if (gainComparison && tags.includes("seguidores")) {
    valores.seguidores = gainComparison.current;
  }

  for (const tag of tags) {
    const distinct = [...new Set(acc.previousFound.get(tag) ?? [])];
    if (distinct.length === 1) valoresAnteriores[tag] = distinct[0];
    else if (distinct.length > 1) {
      conflito = true;
      acc.problemas.push(`${tag} anterior aparece com valores diferentes (${distinct.join(" e ")})`);
    }
  }

  // Mesmas regras de parseMetricJson: receita declarada vence a soma das vendas
  // descritas; agendamento nunca abaixo de venda quando os dois foram informados.
  if (tags.includes("receita") && valores.receita === null) {
    const soma = linhas.filter((l) => l.status !== "agendado").reduce((s, l) => s + (l.valor ?? 0), 0);
    if (soma > 0) valores.receita = soma;
  }
  if (valores.agendamentos != null && valores.vendas != null && valores.agendamentos < valores.vendas) {
    valores.agendamentos = valores.vendas;
  }

  if (gainComparison && tags.includes("seguidores")) {
    acc.seguidoresGanho = gainComparison.current;
    acc.seguidoresGanhoAnterior = gainComparison.previous;
  }

  const algo = Object.values(valores).some((v) => v !== null) || linhas.length > 0;
  const state: ParseState = conflito ? "AMBIGUOUS" : !algo ? "INVALID" : tags.every((t) => valores[t] !== null) ? "PARSED_OK" : "PARTIAL";
  return { state, valores, valoresAnteriores, linhas, problemas: acc.problemas, precisaIa: acc.precisaIa, seguidoresGanho: acc.seguidoresGanho, seguidoresGanhoAnterior: acc.seguidoresGanhoAnterior, custoPorNovoSeguidor };
}

// ---- o modelo do comentário ----------------------------------------------------------

const EXEMPLO: Record<string, string> = {
  vendas: "Vendas: 5",
  agendamentos: "Agendamentos: 8",
  receita: "Receita: R$ 4.100",
  seguidores: "Seguidores: 841",
  verba_disponivel: "Verba disponível: R$ 1.200",
};

/** O comentário correto, com números de exemplo. É o que o pedido de feedback
 *  mostra e o que `parseFeedbackComment` lê como PARSED_OK. */
export function feedbackTemplate(tags: string[]): string {
  const lines = tags.map((t) => EXEMPLO[t] ?? `${t.charAt(0).toUpperCase()}${t.slice(1)}: 12`);
  if (needsRichExtraction(tags)) lines.push("#1 PPF frontal R$ 1.200", "#2 Higienização interna R$ 900");
  return lines.join("\n");
}
