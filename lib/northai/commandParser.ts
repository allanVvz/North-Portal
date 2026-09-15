// Lê um comando curto digitado no Estúdio ("3 reels e 2 carrosséis, gravação
// 22/09, Tock Fatal") e devolve o que dá para pré-preencher numa receita. Não
// cria nada: a pessoa sempre confere a prévia antes. Sem IA — palavras-chave,
// números e datas; o que não reconhecer fica em branco na receita.

import { formatFromWord, normalizeText, type NorthFormatKey } from "./formats";

export type RecipeKey = "diaria" | "plano" | "rotina" | "fluxo" | "automacao" | "analise";
export type Cadence = "semanal" | "quinzenal" | "mensal";

export type ParsedCommand = {
  intent: RecipeKey | null;
  counts: Partial<Record<NorthFormatKey, number>>;
  dates: string[];
  clientSlug: string | null;
  cadence: Cadence | null;
  weekdays: number[];
  links: string[];
};

const INTENT_WORDS: { key: RecipeKey; pattern: RegExp }[] = [
  { key: "diaria", pattern: /\b(diaria|gravacao|gravar|roteiros?)\b/ },
  { key: "automacao", pattern: /\b(automacao|automacoes|automatizar|relatorio|relatorios)\b/ },
  { key: "rotina", pattern: /\b(rotina|rotinas|toda semana|todo mes|semanal|quinzenal|mensal)\b/ },
  { key: "plano", pattern: /\b(plano|planos|planejamento)\b/ },
  { key: "fluxo", pattern: /\b(fluxo|fluxos|entrega|entregas)\b/ },
  { key: "analise", pattern: /\b(analisar|analise|atrasad[ao]s?|parad[ao]s?|falta|faltando|operacao)\b/ },
];

const WEEKDAYS: [RegExp, number][] = [
  [/\bdomingo\b/, 0], [/\bsegunda\b/, 1], [/\bterca\b/, 2], [/\bquarta\b/, 3],
  [/\bquinta\b/, 4], [/\bsexta\b/, 5], [/\bsabado\b/, 6],
];

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoOf(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** dd/mm sem ano é o próximo dd/mm: uma data mais de 60 dias no passado é do ano que vem. */
function parseDates(text: string, today: string): string[] {
  const found: string[] = [];
  const year = Number(today.slice(0, 4));
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (match[3]) {
      const explicit = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      const iso = isoOf(day, month, explicit);
      if (iso) found.push(iso);
      continue;
    }
    let iso = isoOf(day, month, year);
    if (iso && iso < addDays(today, -60)) iso = isoOf(day, month, year + 1);
    if (iso) found.push(iso);
  }
  if (/\bhoje\b/.test(text)) found.push(today);
  if (/\bamanha\b/.test(text)) found.push(addDays(today, 1));
  return [...new Set(found)];
}

export function parseCommand(
  raw: string,
  { clients, today }: { clients: readonly { slug: string; name: string }[]; today: string },
): ParsedCommand {
  const links = raw.match(/https?:\/\/\S+/g) ?? [];
  const text = normalizeText(raw.replace(/https?:\/\/\S+/g, " "));

  const counts: Partial<Record<NorthFormatKey, number>> = {};
  for (const match of text.matchAll(/\b(\d{1,2})\s*(?:x\s*)?([a-z]+)/g)) {
    const key = formatFromWord(match[2]);
    if (key) counts[key] = (counts[key] ?? 0) + Number(match[1]);
  }

  // O nome mais longo primeiro: "Baita Conveniência" antes de "Baita".
  const client = [...clients]
    .sort((a, b) => b.name.length - a.name.length)
    .find((candidate) => {
      const name = normalizeText(candidate.name).trim();
      return (name.length >= 3 && text.includes(name)) || new RegExp(`\\b${candidate.slug}\\b`).test(text);
    });

  const cadence: Cadence | null = /\bquinzena|quinzenal\b/.test(text)
    ? "quinzenal"
    : /\bmensal|todo mes|mensalmente\b/.test(text)
      ? "mensal"
      : /\bsemanal|toda semana|semanalmente\b/.test(text)
        ? "semanal"
        : null;

  let intent = INTENT_WORDS.find((entry) => entry.pattern.test(text))?.key ?? null;
  const dates = parseDates(text, today);
  if (!intent && Object.keys(counts).length) intent = dates.length ? "diaria" : "plano";

  return {
    intent,
    counts,
    dates,
    clientSlug: client?.slug ?? null,
    cadence,
    weekdays: WEEKDAYS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day),
    links,
  };
}
