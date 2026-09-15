// Separa um documento de roteiros colado (o Google Docs da diária de gravação)
// em peças — uma por publicação — sem IA.
//
// A roteirista escreve todos os roteiros da diária num documento só. As formas
// de separar que aparecem na prática, em ordem de confiança:
//
//   1. títulos com a palavra do conteúdo: "ROTEIRO 1 — REELS", "Reels 2: antes e
//      depois", "## Carrossel - dicas" (linha curta, com número, pontuação de
//      título, caixa-alta, # ou **);
//   2. separadores de linha: "---", "***", "___", "===";
//   3. numeração curta no começo da linha ("1. Antes e depois"), desde que não
//      seja uma seção do padrão de roteiro North (gancho, ideia, CTA…), que
//      costuma vir numerada DENTRO de cada roteiro.
//
// Nada disso encontrado, o documento inteiro é uma peça. O formato de cada peça
// sai do título, depois do começo do texto, e cai no padrão (Reels).

import { DEFAULT_FORMAT, detectFormat, normalizeText, type NorthFormatKey } from "./formats";

export type ParsedScript = {
  index: number;
  title: string;
  body: string;
  format: NorthFormatKey;
  /** false quando o formato veio do padrão, não do texto. */
  formatDetected: boolean;
};

const KEYWORD_START = /^(roteiro|script|conteudo|video|reels?|carrossel|carrosseis|banner|story|stories|post|anuncio)\b/;
const SEPARATOR = /^\s*(?:-{3,}|_{3,}|\*{3,}|={3,})\s*$/;
const NUMBERED = /^\s*(\d{1,2})\s*[.)\-–—:]\s+(\S.*)$/;
// Seções do padrão de roteiro North — numeradas dentro de um roteiro, nunca títulos de peça.
const SCRIPT_SECTION = /^(estrategia|ideia|gancho|desenvolvimento|informacao|cta|chamada|abertura|fechamento)\b/;

function stripMarkup(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^__|__$/g, "")
    .trim();
}

function cleanTitle(line: string): string {
  return stripMarkup(line)
    .replace(/^\d{1,2}\s*[.)\-–—:]\s+/, "")
    .replace(/[:\-–—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isKeywordHeading(line: string): boolean {
  const raw = line.trim();
  if (!raw || raw.length > 90) return false;
  const plain = stripMarkup(raw);
  if (!KEYWORD_START.test(normalizeText(plain))) return false;
  const letters = plain.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const shouting = letters.length > 2 && letters === letters.toUpperCase();
  return /\d/.test(plain) || /[:\-–—]/.test(plain) || shouting || raw.startsWith("#") || raw.startsWith("**");
}

function isNumberedHeading(line: string): boolean {
  if (line.trim().length > 90) return false;
  const match = NUMBERED.exec(line);
  if (!match) return false;
  return !SCRIPT_SECTION.test(normalizeText(match[2]));
}

function toPiece(title: string, body: string, index: number): ParsedScript {
  const detected = detectFormat(title) ?? detectFormat(body.slice(0, 240));
  return {
    index,
    title: title || `Roteiro ${index + 1}`,
    body: body.trim(),
    format: detected ?? DEFAULT_FORMAT,
    formatDetected: detected !== null,
  };
}

function splitAtHeadings(lines: string[], isHeading: (line: string) => boolean): ParsedScript[] {
  const pieces: ParsedScript[] = [];
  let title: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (title === null) return;
    pieces.push(toPiece(cleanTitle(title), body.join("\n"), pieces.length));
  };
  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      title = line;
      body = [];
    } else if (title !== null) {
      body.push(line);
    }
  }
  flush();
  return pieces;
}

export function parseScripts(text: string): ParsedScript[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const lines = normalized.split("\n");

  if (lines.filter(isKeywordHeading).length >= 2) return splitAtHeadings(lines, isKeywordHeading);

  if (lines.some((line) => SEPARATOR.test(line))) {
    const chunks = normalized.split(/\n\s*(?:-{3,}|_{3,}|\*{3,}|={3,})\s*(?:\n|$)/).map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length >= 2) {
      return chunks.map((chunk, index) => {
        const [first, ...rest] = chunk.split("\n");
        return toPiece(cleanTitle(first), rest.join("\n"), index);
      });
    }
  }

  if (lines.filter(isNumberedHeading).length >= 2) return splitAtHeadings(lines, isNumberedHeading);

  const [first, ...rest] = lines;
  return [toPiece(cleanTitle(first), rest.join("\n"), 0)];
}
