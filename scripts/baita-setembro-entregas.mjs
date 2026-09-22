// Fase 2: estrutura o conteúdo de setembro/2026 da Baita em Entregas.
//
// Regra que orientou o mapa: a gravação é para REELS — Feed/carrossel não sai de
// diária. Quem não vem de gravação fica sozinho, sem Entrega, em vez de ganhar uma
// Entrega de fachada com três etapas vazias.
//
// O estado encontrado em produção:
//   - existem 2 Entregas "criativo" e apenas UM slot vago em toda a Baita
//     (a publicação de "Evento Baita 26/09");
//   - "Gravação 17/09 — 3 publicações" e "Roteiros da diária 17/09" estão soltos e
//     são compartilháveis: um card pode ser etapa de VÁRIAS Entregas, porque
//     `task_links` é único por (parent_id, child_id) e (parent_id, workflow_step_id),
//     nunca por child_id;
//   - as 3 peças que saíram da diária de 17/09 NÃO existem como card. A única
//     publicação que vence depois da gravação é "Post evento 26/09", e ela pertence
//     à Entrega que já existe. Por isso as Entregas da diária são CRIADAS aqui, com
//     roteiro e captação compartilhados e publicação vaga.
//
// Os nomes em DIARIA_17_09.pecas são provisórios e estão aqui para serem trocados:
// o dry-run imprime exatamente o que seria criado. Edite esta constante, rode o
// dry-run de novo, e só então aplique.
//
// Uso: node scripts/baita-setembro-entregas.mjs [--apply]

import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const APPLY = process.argv.includes("--apply");

const SLUG = "baita-conveniencia";

/** Cards soltos que entram como etapa de uma Entrega que JÁ EXISTE. */
const PREENCHER_VAGO = [
  {
    entrega: "e0b23dce-3f4f-4d2a-bd30-eaa377dbba80", // Evento Baita 26/09
    card: "2d3dff22-7a10-4665-a026-8fc49e7adf21",    // Post evento 26/09
    etapa: "publicacao",
    porque: "nome e data casam com o único slot vago da Baita; vence 20/09, depois da gravação",
  },
];

/** As Entregas que a diária de 17/09 produziu. Roteiro e captação são os MESMOS
 *  cards em todas — é o modelo de bloco compartilhado. Publicação nasce vaga. */
const DIARIA_17_09 = {
  roteiro: "02954165-13bf-5a44-9811-a3de54cd7d80",  // Roteiros da diária 17/09
  captacao: "56a6b5ea-7c05-5095-86e0-86f94860747a", // Gravação 17/09 — 3 publicações
  vence: "2026-09-30",
  pecas: [
    "Diária 17/09 — Reels 1",
    "Diária 17/09 — Reels 2",
    "Diária 17/09 — Reels 3",
  ],
};

/** Ficam SOZINHOS, sem Entrega. Listados para o relatório dizer que a decisão foi
 *  deliberada, e não esquecimento. */
const SEM_ENTREGA = [
  ["1684c4a4-bb60-4c49-ac5b-15c2f1acdcbe", "Post Feed agenda Mês Setembro", "Feed/carrossel — a própria descrição diz 'Postar em formato Carrossel'; não sai de gravação"],
  ["fea9aae7-8d25-44ac-aab0-9250fa87df80", "Postagem motivo do estresse", "publicação avulsa, por decisão do usuário"],
  ["dce78cc2-9736-46c1-bbb2-1ebe53a8a387", "Publicação post Evento", "vence 06/09, antes da gravação de 17/09"],
  ["fafaf36a-8d7c-468b-8363-ab515d94a999", "Post evento 19/09", "vence 13/09, antes da gravação; o evento de 19/09 não tem Entrega própria"],
  ["1e3260fc-ae42-4bc8-a90a-7195f0cec3bf", "Dia do Consumidor", "edição de card promocional, sem publicação associada"],
  ["19405746-eeb2-4ce6-b6cd-655e8132686c", "Post jogando pratos novos", "possível duplicata de 'REELS FEED - Jogando pratos novos', que já está ligado ao Plano de Agosto"],
  ["049c13ad-dcd1-45ea-9a92-fb4523758f17", "DIVULGAÇÃO EVENTO - 12/09", "evento de 12/09, marcado 'finalizado' em comentário"],
];

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows: cli } = await db.query("select id from public.clients where slug = $1", [SLUG]);
  if (!cli.length) throw new Error(`Cliente ${SLUG} não encontrado.`);
  const CLIENTE = cli[0].id;

  // O workflow e os ids de step vêm do banco, nunca fixados aqui: uma versão nova
  // publicada mudaria os ids e um script com eles cravados ligaria etapa errada.
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
      `select id, title, kind, subtype, status, due_date, client_id, reviewer_id, priority, position
         from public.tasks where id = $1::uuid`, [id]);
    return rows[0] ?? null;
  };

  console.log(`\nWorkflow: ${WORKFLOW}  (etapas: ${wf.map((s) => s.etapa).join(" → ")})\n`);

  // ---- 1. preencher slots vagos -------------------------------------------
  console.log("1. PREENCHER SLOT VAGO EM ENTREGA EXISTENTE");
  const paraLigar = [];
  for (const p of PREENCHER_VAGO) {
    const [entrega, filho] = [await card(p.entrega), await card(p.card)];
    if (!entrega || !filho) { console.log(`   ! card inexistente (${p.entrega} / ${p.card}) — pulado`); continue; }
    const { rows: ocupado } = await db.query(
      `select c.title from public.task_links l join public.tasks c on c.id = l.child_id
        where l.parent_id = $1::uuid and l.workflow_step_id = $2::uuid`, [p.entrega, stepId(p.etapa)]);
    if (ocupado.length) { console.log(`   ! ${entrega.title} / ${p.etapa} já ocupado por "${ocupado[0].title}" — pulado`); continue; }
    console.log(`   ${entrega.title}  ${p.etapa} ← "${filho.title}"`);
    console.log(`     porque: ${p.porque}`);
    paraLigar.push({ parent: p.entrega, child: p.card, step: stepId(p.etapa), etapa: p.etapa });
  }

  // ---- 2. Entregas da diária ----------------------------------------------
  console.log("\n2. ENTREGAS DA DIÁRIA 17/09 — roteiro e captação COMPARTILHADOS");
  const roteiro = await card(DIARIA_17_09.roteiro);
  const captacao = await card(DIARIA_17_09.captacao);
  if (!roteiro || !captacao) throw new Error("Cards de roteiro/captação da diária não encontrados.");
  console.log(`   roteiro  compartilhado: "${roteiro.title}"`);
  console.log(`   captação compartilhada: "${captacao.title}"`);
  for (const nome of DIARIA_17_09.pecas) {
    console.log(`\n   Entrega a criar: "${nome}"  (vence ${DIARIA_17_09.vence})`);
    console.log(`     roteiro    ← ${roteiro.title}   [compartilhado]`);
    console.log(`     captacao   ← ${captacao.title}  [compartilhado]`);
    console.log(`     edicao     ← vago`);
    console.log(`     publicacao ← vago`);
  }
  console.log("\n   ⚠ Os nomes acima são PROVISÓRIOS. Troque DIARIA_17_09.pecas antes de aplicar.");

  // ---- 3. o que fica sozinho ----------------------------------------------
  console.log("\n3. FICAM SEM ENTREGA — decisão deliberada");
  for (const [id, titulo, porque] of SEM_ENTREGA) {
    const c = await card(id);
    console.log(`   ${c ? "" : "(card inexistente) "}${titulo}`);
    console.log(`     ${porque}`);
  }

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Revise os nomes e rode com --apply.\n");
    process.exit(0);
  }

  // ---- aplicar -------------------------------------------------------------
  await db.query("begin");
  try {
    for (const l of paraLigar) {
      const { rowCount } = await db.query(`
        insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
        values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)
        on conflict do nothing returning parent_id`, [l.parent, l.child, l.step]);
      console.log(rowCount === 1 ? `ok: ligado ${l.etapa}` : `já existia: ${l.etapa}`);
    }

    for (const nome of DIARIA_17_09.pecas) {
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
        [CLIENTE, nome, DIARIA_17_09.vence, roteiro.reviewer_id, DELIVERY_TYPE, WORKFLOW]);
      const entregaId = nova[0].id;
      for (const [etapa, filho] of [["roteiro", DIARIA_17_09.roteiro], ["captacao", DIARIA_17_09.captacao]]) {
        await db.query(`
          insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
          values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)
          on conflict do nothing`, [entregaId, filho, stepId(etapa)]);
      }
      console.log(`ok: Entrega "${nova[0].title}" criada (${entregaId}) com roteiro e captação compartilhados`);
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
