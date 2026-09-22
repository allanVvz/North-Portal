// Reexecuta o tique de automações em produção, pela porta do cron.
//
// Por que pela porta do cron e não por `{ configIds }`: esse outro caminho é
// gated por `requireAdmin()`, que exige sessão de navegador — um script não tem.
// A porta do cron usa o `x-cron-secret` do .env.local e chama exatamente o que o
// pg_cron chamaria, com `today = agencyToday()`.
//
// É seguro repetir:
//   - `claim_automation_run` reivindica de novo apenas runs `failed`/`pending`
//     (ou `running` com mais de 15 min), nunca um `succeeded`;
//   - o compare-and-set de status aceita etapa em `parada` e recusa etapa que uma
//     pessoa já aprovou;
//   - ids de ocorrência e de comentário são determinísticos.
//
// Uso:
//   node scripts/rerun-automations.mjs            # produção (northportal.vercel.app)
//   node scripts/rerun-automations.mjs http://localhost:3000
//
// IMPORTANTE: só faz sentido depois de resolver a causa da falha. Se a credencial
// da Meta ainda estiver em checkpoint, isso só vai reescrever o mesmo erro.

import { readFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const readEnv = (key) => {
  const match = envText.match(new RegExp("^" + key + "=(.*)$", "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
};

const secret = readEnv("CRON_SECRET");
if (!secret) {
  console.error("CRON_SECRET ausente em .env.local — é o mesmo valor do segredo `automations_cron_secret` no Vault do Supabase.");
  process.exit(1);
}

const base = (process.argv[2] ?? "https://northportal.vercel.app").replace(/\/$/, "");
const url = `${base}/api/admin/automations/run`;

console.log(`POST ${url}`);
const started = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-cron-secret": secret },
  body: "{}",
});
const text = await res.text();
console.log(`HTTP ${res.status} em ${((Date.now() - started) / 1000).toFixed(1)}s`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 2000));
}
process.exit(res.ok ? 0 : 1);
