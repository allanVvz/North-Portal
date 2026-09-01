// Dispara runAutomations() + reconcileFlows() contra o banco REAL — o mesmo
// que a cron faz (app/api/admin/automations/run/route.ts). Inerte no CI (roda
// só com RUN_AUTOMATIONS setado). Lê credenciais de .env.local.
//
//   RUN_AUTOMATIONS=1 npx vitest run lib/automations/e2e.manual.test.ts
//
// Sequência completa do fluxo de conversão: use junto com
// scripts/relatorio-conversao-e2e.mjs (seed / comment / inspect).

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
  } catch { /* .env.local ausente — o teste é skip */ }
}

describe.skipIf(!process.env.RUN_AUTOMATIONS)("runAutomations + reconcileFlows (banco real)", () => {
  it("roda um tique da cron", async () => {
    loadEnvLocal();
    const { runAutomations } = await import("./run");
    const { reconcileFlows } = await import("@/lib/flows/reconcile");
    const summary = await runAutomations();
    const flows = await reconcileFlows();
    console.log("automations:", JSON.stringify(summary));
    console.log("flows:", JSON.stringify(flows));
    expect(summary.errors).toEqual([]);
    expect(flows.errors).toEqual([]);
  }, 180_000);
});
