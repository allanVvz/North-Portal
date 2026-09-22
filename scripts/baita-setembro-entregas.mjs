// Fase 2: estrutura o conteúdo de setembro/2026 da Baita em Entregas.
//
// Esta versão substitui a anterior, que estava errada: ela montava Entregas a partir
// da "Gravação 17/09 — 3 publicações" (card solto) e ignorava as 9 atividades que já
// estavam no Plano de Conteúdo. São elas que descrevem o mês de verdade — dois
// blocos, 6 Reels e 2 anúncios — e o card solto de 17/09 pode ser a mesma diária do
// bloco ("Gravação do bloco — 6 Reels", 16/09) registrada duas vezes. Enquanto isso
// não estiver confirmado, nada é criado a partir dele.
//
// O que esta versão faz, e só isso:
//
//   1. O evento de 19/09 e o de 26/09 NÃO aconteceram — viraram 10/10. As duas peças
//      dele (um reels e um carrossel) existem como card, com nomes que não dizem o
//      que são ("post video 1 edicao", "post 2 edicao"). Os nomes são corrigidos e
//      cada peça ganha sua Entrega.
//   2. As duas Entregas COMPARTILHAM roteiro, captação e edição do evento 26: é o
//      mesmo material, gravado uma vez, editado uma vez, publicado em dois formatos.
//      `task_links` é único por (parent_id, child_id) e (parent_id, workflow_step_id),
//      nunca por child_id — então o mesmo card de edição é etapa das duas Entregas
//      sem ser duplicado.
//
// Uso: node scripts/baita-setembro-entregas.mjs [--apply]

import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const APPLY = process.argv.includes("--apply");

const SLUG = "baita-conveniencia";

/** A data real do evento. O de 19/09 e o de 26/09 não aconteceram. */
const EVENTO = "2026-10-10";

/** As etapas do evento, compartilhadas pelas duas peças. Ficam como estão — só são
 *  referenciadas. */
const COMPARTILHADAS = {
  roteiro: "05bdfa56-e9d7-58a3-a998-ef348611da78",  // Evento Baita 26/09 — Roteiro
  captacao: "51791021-7d17-5a99-be73-b3d536c861b9", // Evento Baita 19/09 — Captação
  edicao: "f6c9580e-aa2f-486d-8937-88dbe52a6bcd",   // edição materiais evento Baita 26/09
};

/** Plano de Ação que recebe as duas Entregas do evento. É onde o material do
 *  evento já vive hoje: a Entrega original e as duas peças de publicação são
 *  membros de "Tarefas do mes de setembro" — não do "PLANO DE CONTEÚDO -
 *  OUTUBRO" (que é o plano dos blocos de 6 Reels e 2 anúncios, outra frente). */
const PLANO_EVENTO = "1f179322-90f0-4a2d-8df0-9b72507dda27"; // Tarefas do mes de setembro

/** Uma Entrega por formato. O card de publicação já existe: só é renomeado (o nome
 *  atual diz "edicao", que é justamente o que ele NÃO é) e recebe o subtype certo. */
const PECAS = [
  {
    card: "ae531085-9be9-433a-8540-0e1144d357a8", // post video 1 edicao
    entrega: `Evento Baita 10/10 — Reels`,
    publicacao: `Evento Baita 10/10 — Reels · Publicação`,
  },
  {
    card: "0dd39e0b-a172-4662-a6ef-b06230950bcc", // post 2 edicao
    entrega: `Evento Baita 10/10 — Carrossel`,
    publicacao: `Evento Baita 10/10 — Carrossel · Publicação`,
  },
];

/** Os nomes das etapas compartilhadas também mentem: falam de 19/09 e 26/09, eventos
 *  que não ocorreram. Renomeados para a data real, mantendo a convenção de sufixo que
 *  o repositório já usa ("<Entrega> — <Etapa>"). */
const RENOMEAR_ETAPAS = [
  { card: COMPARTILHADAS.roteiro, para: "Evento Baita 10/10 — Roteiro" },
  { card: COMPARTILHADAS.captacao, para: "Evento Baita 10/10 — Captação" },
  { card: COMPARTILHADAS.edicao, para: "Evento Baita 10/10 — Edição" },
];

const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows: cli } = await db.query("select id from public.clients where slug = $1", [SLUG]);
  if (!cli.length) throw new Error(`Cliente ${SLUG} não encontrado.`);
  const CLIENTE = cli[0].id;

  // Workflow e ids de etapa vêm do banco, nunca fixados aqui: uma versão nova
  // publicada mudaria os ids, e um script com eles cravados ligaria etapa errada em
  // silêncio.
  const { rows: wf } = await db.query(`
    select v.id, v.delivery_type_id, s.id as step_id, tt.key as etapa, s.order_index
    from public.workflow_versions v
    join public.workflow_version_steps s on s.workflow_version_id = v.id
    join public.task_types tt on tt.id = s.task_type_id
    where v.status = 'published' and v.label ilike 'criativo%'
    order by s.order_index`);
  if (!wf.length) throw new Error("Workflow publicado de Criativo não encontrado.");
  const WORKFLOW = wf[0].id;
  const DELIVERY_TYPE = wf[0].delivery_type_id;
  const stepId = (etapa) => {
    const hit = wf.find((s) => s.etapa === etapa);
    if (!hit) throw new Error(`Etapa "${etapa}" não existe no workflow publicado.`);
    return hit.step_id;
  };

  const card = async (id) => {
    const { rows } = await db.query(
      `select id, title, kind, subtype, status, due_date, reviewer_id from public.tasks where id = $1::uuid`, [id]);
    return rows[0] ?? null;
  };

  console.log(`\nWorkflow: ${WORKFLOW}  (${wf.map((s) => s.etapa).join(" → ")})`);
  console.log(`Evento real: ${EVENTO}  (19/09 e 26/09 não aconteceram)\n`);

  console.log("1. RENOMEAR AS ETAPAS COMPARTILHADAS");
  const renomear = [];
  for (const r of RENOMEAR_ETAPAS) {
    const c = await card(r.card);
    if (!c) { console.log(`   ! ${r.card} não existe — pulado`); continue; }
    if (c.title === r.para) { console.log(`   já correto: ${c.title}`); continue; }
    console.log(`   "${c.title}"`);
    console.log(`     → "${r.para}"   [${c.subtype ?? "—"}, ${c.status}, ${dia(c.due_date)}]`);
    renomear.push({ id: c.id, para: r.para, de: c.title });
  }

  console.log("\n2. AS DUAS ENTREGAS — roteiro, captação e edição COMPARTILHADOS");
  const roteiro = await card(COMPARTILHADAS.roteiro);
  const captacao = await card(COMPARTILHADAS.captacao);
  const edicao = await card(COMPARTILHADAS.edicao);
  if (!roteiro || !captacao || !edicao) throw new Error("Etapa compartilhada não encontrada.");

  const criar = [];
  for (const p of PECAS) {
    const pub = await card(p.card);
    if (!pub) { console.log(`   ! ${p.card} não existe — pulado`); continue; }
    console.log(`\n   Entrega: "${p.entrega}"   (vence ${EVENTO})`);
    console.log(`     roteiro    ← ${roteiro.title}   [compartilhado]`);
    console.log(`     captacao   ← ${captacao.title}  [compartilhado]`);
    console.log(`     edicao     ← ${edicao.title}    [compartilhado]`);
    console.log(`     publicacao ← "${pub.title}" → "${p.publicacao}"`);
    console.log(`                  subtype ${pub.subtype ?? "—"} → publicacao, vence — → ${EVENTO}`);
    console.log(`     plano      ← Tarefas do mes de setembro`);
    criar.push({ ...p, pub });
  }

  console.log("\n3. FORA DESTA RODADA — precisa de decisão");
  console.log(`   Bloco 6 Reels e bloco 2 anúncios: ver scripts/baita-outubro-blocos.mjs.`);
  console.log(`   "Gravação 17/09 — 3 publicações" (solta) pode ser a mesma diária de`);
  console.log(`   "Gravação do bloco — 6 Reels" (16/09, no plano) — confirmar antes de usar.`);

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db.query("begin");
  try {
    for (const r of renomear) {
      await db.query("update public.tasks set title = $2 where id = $1::uuid", [r.id, r.para]);
      console.log(`ok: renomeado → "${r.para}"`);
    }

    for (const c of criar) {
      // O card de publicação é corrigido ANTES de a Entrega nascer: nome, subtype e
      // data. Sem o subtype `publicacao` ele não é reconhecível como a etapa que é.
      await db.query(
        `update public.tasks set title = $2, subtype = 'publicacao', due_date = $3::date,
                end_date = case when end_date is null then null else greatest($3::date, end_date) end
           where id = $1::uuid`, [c.pub.id, c.publicacao, EVENTO]);

      const { rows: nova } = await db.query(`
        insert into public.tasks (
          client_id, kind, subtype, title, status, priority, assignee,
          due_date, start_date, end_date, position, client_visible, progress_weight,
          requires_review, requires_approval, reviewer_id, task_type_id, workflow_version_id, payload
        ) values (
          $1::uuid, 'criativo', null, $2, 'backlog', 'media', null,
          $3::date, $3::date, $3::date, 0, false, 1,
          true, false, $4::uuid, $5::uuid, $6::uuid, '{}'::jsonb
        ) returning id, title`,
        [CLIENTE, c.entrega, EVENTO, edicao.reviewer_id, DELIVERY_TYPE, WORKFLOW]);
      const entregaId = nova[0].id;

      for (const [etapa, filho] of [
        ["roteiro", COMPARTILHADAS.roteiro],
        ["captacao", COMPARTILHADAS.captacao],
        ["edicao", COMPARTILHADAS.edicao],
        ["publicacao", c.pub.id],
      ]) {
        await db.query(`
          insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
          values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)
          on conflict do nothing`, [entregaId, filho, stepId(etapa)]);
      }
      // A Entrega nasce SOLTA — nada aqui a liga a plano nenhum ainda — então ela
      // entra explicitamente como membro de "Tarefas do mes de setembro", de onde
      // o material do evento já vem.
      await db.query(`
        insert into public.task_links (parent_id, child_id, relation_kind, position)
        values ($1::uuid, $2::uuid, 'structural_member', 0)
        on conflict do nothing`, [PLANO_EVENTO, entregaId]);
      console.log(`ok: Entrega "${nova[0].title}" (${entregaId}) com as 4 etapas, membro de "Tarefas do mes de setembro"`);
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
