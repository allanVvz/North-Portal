// O evento não é mais dia 26/09 — virou 10/10 ("Evento Baita 10/10 — Reels" e
// "— Carrossel", scripts/baita-setembro-entregas.mjs). Dois cards ficaram
// falando de uma data que não existe mais:
//
//   1. "Evento Baita 26/09" (e0b23dce) — a Entrega ANTIGA. Já é membro de
//      "Tarefas do mes de setembro" e compartilha roteiro/captação/edição com
//      as 2 Entregas novas (é literalmente o mesmo material). Sem etapa de
//      publicação própria, ela não representa mais nada de real — está
//      obsoleta, substituída pelas 2 novas. `status` é projetado dos filhos
//      (trigger reject_manual_rollup_status bloqueia update manual em Entrega
//      com workflow_version_id) — não dá, e não faz sentido, forçar isso; só
//      o TÍTULO é corrigido, pra não confundir quem olha o plano.
//   2. "Post evento 26/09" (2d3dff22) — card solto, kind=criativo SEM
//      workflow_version_id, sem link nenhum. Tem 2 comentários reais do Allan
//      (21/09) com referências de design (Canva/Figma) do "Formato de
//      publicação Evento" — não é lixo, é referência ainda útil pro evento
//      10/10. Renomeado pra refletir isso e linkado como membro de "Tarefas
//      do mes de setembro" (regra: toda Entrega dentro de um dos 2 planos).
//
// Uso: node scripts/baita-evento-2609-obsoleto.mjs [--apply]

import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const APPLY = process.argv.includes("--apply");

const PLANO_SETEMBRO = "1f179322-90f0-4a2d-8df0-9b72507dda27"; // Tarefas do mes de setembro

const ENTREGA_OBSOLETA = {
  id: "e0b23dce-3f4f-4d2a-bd30-eaa377dbba80",
  para: "Evento Baita 26/09 (obsoleto — virou Evento 10/10, ver Reels/Carrossel)",
};

const REFERENCIA = {
  id: "2d3dff22-7a10-4665-a026-8fc49e7adf21",
  para: "Evento Baita 10/10 — Referências de publicação (Canva/Figma)",
};

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const card = async (id) => {
    const { rows } = await db.query(
      `select id, title, status, kind from public.tasks where id = $1::uuid`, [id]);
    return rows[0] ?? null;
  };
  const jaMembro = async (planoId, childId) => {
    const { rows } = await db.query(
      `select 1 from public.task_links where parent_id = $1::uuid and child_id = $2::uuid and relation_kind = 'structural_member'`,
      [planoId, childId]);
    return rows.length > 0;
  };

  const entrega = await card(ENTREGA_OBSOLETA.id);
  const referencia = await card(REFERENCIA.id);
  if (!entrega || !referencia) throw new Error("Um dos 2 cards não foi encontrado.");

  console.log("1. RENOMEAR — Entrega obsoleta (só título, status é projetado dos filhos)");
  console.log(`   "${entrega.title}"  [${entrega.status}]`);
  console.log(`     → "${ENTREGA_OBSOLETA.para}"`);

  console.log("\n2. RENOMEAR + LINKAR — referência de design vira membro do plano de setembro");
  console.log(`   "${referencia.title}"  [${referencia.status}]`);
  console.log(`     → "${REFERENCIA.para}"`);
  const membro = await jaMembro(PLANO_SETEMBRO, REFERENCIA.id);
  console.log(membro
    ? `     já é membro de "Tarefas do mes de setembro" — nada a linkar`
    : `     será linkado como membro de "Tarefas do mes de setembro"`);

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db.query("begin");
  try {
    await db.query("update public.tasks set title = $2 where id = $1::uuid", [ENTREGA_OBSOLETA.id, ENTREGA_OBSOLETA.para]);
    console.log(`ok: renomeado → "${ENTREGA_OBSOLETA.para}"`);

    await db.query("update public.tasks set title = $2 where id = $1::uuid", [REFERENCIA.id, REFERENCIA.para]);
    console.log(`ok: renomeado → "${REFERENCIA.para}"`);

    if (!membro) {
      await db.query(`
        insert into public.task_links (parent_id, child_id, relation_kind, position)
        values ($1::uuid, $2::uuid, 'structural_member', 0)
        on conflict do nothing`, [PLANO_SETEMBRO, REFERENCIA.id]);
      console.log(`ok: "${REFERENCIA.para}" agora é membro de "Tarefas do mes de setembro"`);
    }

    await db.query("commit");
    console.log("\nTransação confirmada.\n");
  } catch (e) {
    await db.query("rollback");
    console.error(`ERRO, nada gravado: ${e?.message ?? e}`);
    process.exit(1);
  }
} finally {
  await db.end();
}
