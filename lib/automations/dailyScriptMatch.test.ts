import { describe, expect, it } from "vitest";
import { matchDailyScripts } from "./dailyScriptMatch";

const pieces = [
  { key: "a", name: "Primeiro", format: "Reels" },
  { key: "b", name: "Segundo", format: "Reels" },
];

describe("matchDailyScripts", () => {
  it("associa roteiros na ordem do Plano quando quantidade e formato coincidem", () => {
    const result = matchDailyScripts("## Roteiro 1 — Reels\nGancho A\n## Roteiro 2 — Reels\nGancho B", pieces);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scripts.map((item) => [item.pieceKey, item.description])).toEqual([
      ["a", "Roteiro 1 — Reels\n\nGancho A"], ["b", "Roteiro 2 — Reels\n\nGancho B"],
    ]);
  });

  it("pede informação quando faltam roteiros ou o formato diverge", () => {
    expect(matchDailyScripts("Roteiro 1 — Reels\nTexto", pieces).ok).toBe(false);
    const wrong = matchDailyScripts("## Roteiro 1 — Story\nTexto\n## Roteiro 2 — Reels\nTexto", pieces);
    expect(wrong.ok).toBe(false);
  });

  it("preserva a composição de 12 peças quando o documento traz 12 roteiros", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({ key: `piece-${index}`, name: `Peça ${index + 1}`, format: "Reels" }));
    const document = twelve.map((_, index) => `## Roteiro ${index + 1} — Reels\nCena ${index + 1}`).join("\n");
    const result = matchDailyScripts(document, twelve);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scripts).toHaveLength(12);
  });
});
