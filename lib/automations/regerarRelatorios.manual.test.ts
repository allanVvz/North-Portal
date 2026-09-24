// Regeração de MANUTENÇÃO dos dois relatórios de uma semana já processada,
// contra o banco de PRODUÇÃO. Não é um teste: é um script operacional, e mora
// aqui porque só o vitest carrega os módulos TS do app com o alias `@/`
// (os `scripts/*.mjs` falam SQL direto, não passam pelo código da automação).
//
//   RUN_REGEN=1 npx vitest run lib/automations/regerarRelatorios.manual.test.ts
//
// Sem `RUN_REGEN` não faz nada — é o que mantém `npm test` e o verify limpos.
//
// Usa as portas próprias `regenerateTrafficReport` / `regenerateConversionReport`,
// nunca o caminho de revisão. É a regra de 24/09, e o motivo é concreto: o
// caminho de revisão EXIGE uma instrução humana, grava no card e a IMPRIME no
// PDF, na seção "Revisão solicitada". Regerar layout por ali obrigava a inventar
// uma frase — e a frase sintética ("Regerar o relatório com o layout atual…")
// vazou para o relatório que o time lê. Aqui não há o que inventar.
//
// O que esta regeração NÃO faz, de propósito: não move etapa de status, não
// desfaz aprovação, não apaga o feedback já colhido, não reabre a cascata e não
// relê comentário atrás de instrução (o que a Luiza pediu na semana continua
// gravado na ocorrência e continua sendo aplicado). Mesmos números, mesmo
// período, só o desenho muda.
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

// Ids das ETAPAS (não das Entregas): `relatorio_anuncios` e `relatorio_conversao`
// dos três clientes com a cascata completa da semana de 15–21/09.
const ALVOS = [
  { cliente: "Baita Conveniencia", trafego: "56099643-02cd-537e-817c-fb29534c1567", conversao: "051f648c-49a7-5513-9b07-7ce68cbc8ebf" },
  { cliente: "FALKE ESTÉTICA", trafego: "903f0d67-eb4e-5102-8e51-7e4710882895", conversao: "84b243e5-c335-59b6-bf34-285fe3d47aac" },
  { cliente: "CRIS CAR CARE", trafego: "d482e1e6-6ba6-5707-8c16-772a67de6e8b", conversao: "a2681019-8b63-5e9e-890b-b6e2f7482184" },
];

describe.skipIf(!process.env.RUN_REGEN)("regera tráfego + conversão com o layout atual (banco real)", () => {
  it.each(ALVOS)("$cliente", async ({ trafego, conversao }) => {
    loadEnvLocal();
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { regenerateTrafficReport } = await import("./run");
    const { regenerateConversionReport } = await import("./conversionFlow");
    const admin = createAdminClient();

    const ultimo = async (id: string) => {
      const { data } = await admin.from("tasks").select("status, payload").eq("id", id).single();
      const payload = data?.payload as { comments?: { text?: string }[] } | null;
      return `${data?.status ?? "?"} | ${(payload?.comments?.at(-1)?.text ?? "(sem comentário)").replace(/\s+/g, " ").slice(0, 170)}`;
    };

    // 1. Relatório de anúncios (interno). Etapa aprovada continua regerável:
    //    aprovar é sobre conteúdo, e o conteúdo não muda.
    const r = await regenerateTrafficReport(admin, trafego);
    console.log("TRÁFEGO  ", r ? `rev ${r.revision} · ${r.fileName}` : "IGNORADO (etapa não resolvida)");
    expect(r, "regenerateTrafficReport devolveu null — etapa/config não resolvida").not.toBeNull();

    // 2. Relatório de conversão (o que vai ao cliente). Depende do relatório de
    //    tráfego final acima, por isso nesta ordem.
    await regenerateConversionReport(admin, conversao);
    console.log("CONVERSÃO", await ultimo(conversao));
  }, 240_000);
});
