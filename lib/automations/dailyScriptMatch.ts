import { detectFormat, normalizeText } from "@/lib/northai/formats";
import { parseScripts, type ParsedScript } from "@/lib/northai/scriptParser";

export type DailyScriptPiece = { key: string; name: string; format: string };
export type MatchedDailyScript = { pieceKey: string; title: string; description: string; sourceIndex: number };
export type DailyScriptMatch =
  | { ok: true; scripts: MatchedDailyScript[] }
  | { ok: false; question: string; parsed: ParsedScript[] };

/** Conservative one-to-one reconciliation. The order is the published Plan's
 * order; a count or an explicit format mismatch requires a human answer. */
export function matchDailyScripts(text: string, pieces: readonly DailyScriptPiece[]): DailyScriptMatch {
  const parsed = parseScripts(text);
  if (!parsed.length) return { ok: false, question: "O roteiro está vazio. Envie um Docs ou TXT com os roteiros desta diária.", parsed };
  if (parsed.length !== pieces.length) {
    return { ok: false, question: `Encontrei ${parsed.length} roteiro(s) para ${pieces.length} Criativo(s). Indique qual roteiro corresponde a cada Criativo ou atualize as quantidades no Plano.`, parsed };
  }
  const mismatches = parsed.flatMap((script, index) => {
    if (!script.formatDetected) return [];
    const expected = detectFormat(pieces[index].format) ?? detectFormat(pieces[index].name);
    return expected && expected !== script.format ? [`${index + 1}: ${script.title} → ${pieces[index].name}`] : [];
  });
  if (mismatches.length) {
    return { ok: false, question: `Os formatos não coincidem com a ordem do Plano (${mismatches.join("; ")}). Informe a correspondência correta no comentário ou ajuste os Criativos.`, parsed };
  }
  const titles = parsed.map((script) => normalizeText(script.title).replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(titles).size !== titles.length) {
    return { ok: false, question: "Há títulos de roteiro repetidos. Diferencie os títulos para associar cada um a um Criativo.", parsed };
  }
  return { ok: true, scripts: parsed.map((script, index) => ({
    pieceKey: pieces[index].key,
    title: script.title,
    description: [script.title, script.body].filter(Boolean).join("\n\n"),
    sourceIndex: script.index,
  })) };
}
