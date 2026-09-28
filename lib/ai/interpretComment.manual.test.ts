// Eval do intérprete com o MODELO DE VERDADE sobre o corpus de comentários
// reais. Não é teste de CI: gasta chamada de IA e depende da credencial.
//
//   RUN_AI_EVAL=1 npx vitest run lib/ai/interpretComment.manual.test.ts
//   RUN_AI_EVAL=1 OPENAI_INTERPRET_MODEL=gpt-4o npx vitest run lib/ai/interpretComment.manual.test.ts
//
// Imprime, por caso, os campos que o modelo errou, e a taxa de acerto. Use
// antes de trocar de modelo ou mexer no prompt.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env.local ausente */ }
}

describe.skipIf(!process.env.RUN_AI_EVAL)("intérprete × modelo real", () => {
  it("corpus", async () => {
    loadEnvLocal();
    const { interpretComment } = await import("./interpretComment");
    const { CORPUS, mismatches } = await import("./interpretComment.corpus");
    let wrong = 0;
    for (const c of CORPUS) {
      const i = await interpretComment(c.text, c.ctx);
      const miss = mismatches(c, i);
      if (miss.length) wrong += 1;
      console.log(`${miss.length ? "ERRO" : "ok  "} ${c.id} [${i.source}]${miss.length ? ` — ${miss.join(", ")}` : ""}`);
    }
    console.log(`acerto: ${CORPUS.length - wrong}/${CORPUS.length}`);
    expect(wrong).toBe(0);
  }, 300_000);
});
