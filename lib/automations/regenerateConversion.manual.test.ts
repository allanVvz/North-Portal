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

  const ALVOS = [
    { client: "Baita Conveniencia", adsTaskId: "56099643-02cd-537e-817c-fb29534c1567", convTaskId: "051f648c-49a7-5513-9b07-7ce68cbc8ebf" },
    { client: "FALKE ESTÉTICA", adsTaskId: "903f0d67-eb4e-5102-8e51-7e4710882895", convTaskId: "84b243e5-c335-59b6-bf34-285fe3d47aac" },
    { client: "CRIS CAR CARE", adsTaskId: "d482e1e6-6ba6-5707-8c16-772a67de6e8b", convTaskId: "a2681019-8b63-5e9e-890b-b6e2f7482184" },
  ];

  // Instrução neutra: `handleTrafficRevisionComment` exige uma, grava no card e
  // passa para a geração. Esta diz explicitamente que é regeração de layout,
  // para não distorcer a leitura dos números.
  const INSTRUCAO_TRAFEGO = "Regerar o relatório com o layout atual, sem mudança de conteúdo nem de números.";

  describe.skipIf(!process.env.RUN_REGEN)("regenera tráfego + conversão v17 (banco real)", () => {
    it.each(ALVOS)("$client", async ({ adsTaskId, convTaskId }) => {
      loadEnvLocal();
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { handleConversionRevisionComment } = await import("./conversionFlow");
      const { handleTrafficRevisionComment } = await import("./run");
      const admin = createAdminClient();

      // 1. Relatório de anúncios (interno). Só roda com a etapa reaberta —
      // `completed_at` limpo antes, por SQL; o código recusa regerar etapa
      // aprovada de propósito.
      await handleTrafficRevisionComment(admin, adsTaskId, { instruction: INSTRUCAO_TRAFEGO });
      const ads = await admin.from("tasks").select("status,payload").eq("id", adsTaskId).single();
      const adsComments = (ads.data?.payload as { comments?: { text?: string }[] } | null)?.comments ?? [];
      console.log("ANÚNCIOS", adsTaskId, ads.data?.status, "|", adsComments.at(-1)?.text?.slice(0, 160));

      // 2. Relatório de conversão (o que vai ao cliente).
      await handleConversionRevisionComment(admin, convTaskId);
      const conv = await admin.from("tasks").select("status,payload").eq("id", convTaskId).single();
      const convComments = (conv.data?.payload as { comments?: { text?: string }[] } | null)?.comments ?? [];
      console.log("CONVERSÃO", convTaskId, conv.data?.status, "|", convComments.at(-1)?.text?.slice(0, 200));

      expect(convComments.length).toBeGreaterThan(0);
    }, 180_000);
  });
