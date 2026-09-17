// Backfill único: pré-cria o CONTÊINER (vazio, sem etapas) do próximo ciclo
// do fluxo de relatório para todo molde com `relatorio_trafego_semanal`
// ativo — a mesma correção que `runOneReportAutomation` (lib/automations/
// run.ts) passou a fazer sozinha a cada disparo, só que agora, sem esperar
// o próximo disparo natural de cada cliente.
//
// Chama a função real (ensureFlowOccurrence), a mesma que a automação usa —
// não reimplementa o formato do card à mão. Idempotente: se o contêiner do
// ciclo já existir, não faz nada.
//
//   RUN_AUTOMATIONS=1 npx vitest run lib/automations/backfillReportOccurrences.manual.test.ts
//
// Descartável depois de rodado uma vez — mantido no repo pelo mesmo motivo
// de e2e.manual.test.ts: inerte no CI (roda só com RUN_AUTOMATIONS setado).

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

describe.skipIf(!process.env.RUN_AUTOMATIONS)("backfill: contêiner do próximo ciclo do relatório (banco real)", () => {
  it("pré-cria o contêiner de todo molde ativo que ainda não tem um", async () => {
    loadEnvLocal();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { ensureFlowOccurrence } = await import("./execute");
    const { asTaskRecord } = await import("./taskAccess");
    const admin = createAdminClient();

    const { data: configs, error: configsError } = await admin
      .from("automation_configs")
      .select("target_task_id")
      .eq("automation_key", "relatorio_trafego_semanal")
      .eq("active", true);
    if (configsError) throw configsError;
    const moldIds = [...new Set((configs ?? []).map((c) => c.target_task_id as string))];

    const results: { moldId: string; occurrenceId: string; dueDate: string | null }[] = [];
    for (const moldId of moldIds) {
      const { data: moldRows, error: moldError } = await admin.from("tasks").select("*").eq("id", moldId).limit(1);
      if (moldError) throw moldError;
      if (!moldRows?.[0]) continue;
      const mold = asTaskRecord(moldRows[0]);
      const occ = await ensureFlowOccurrence(admin, mold, mold.due_date as string);
      results.push({ moldId, occurrenceId: occ.id, dueDate: occ.due_date });
    }

    console.log("backfill:", JSON.stringify(results, null, 2));
    expect(results.length).toBe(moldIds.length);
  }, 120_000);
});
