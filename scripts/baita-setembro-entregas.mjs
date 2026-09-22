// Fase 2: estrutura o conteúdo de setembro/2026 da Baita em Entregas.
//
// Regra que orientou o mapa: a gravação é para REELS — Feed/carrossel não sai de
// diária. Quem não vem de gravação fica sozinho, sem Entrega, em vez de ganhar uma
// Entrega de fachada com três etapas vazias.
//
// O estado encontrado em produção:
//   - existem 2 Entregas "criativo" e apenas UM slot vago em toda a Baita
//     (a publicação de "Evento Baita 26/09"), preenchido por "Post evento 26/09";
//   - "Gravação 17/09 — 3 publicações" e "Roteiros da diária 17/09" estão soltos e
//     são compartilháveis: um card pode ser etapa de VÁRIAS Entregas, porque
//     `task_links` é único por (parent_id, child_id) e (parent_id, workflow_step_id),
//     nunca por child_id;
//   - as datas das publicações estavam erradas — venciam ANTES da gravação que as
//     originou. Corrigidas, as três peças da diária aparecem e a conta fecha com o
//     título da captação.
//
// A Entrega recebe o título da própria publicação que entrega, como já acontece em
// "Reels Dj Sereno" — nomear peça de conteúdo que não se sabe qual é seria inventar
// história.
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

/** Quantos dias as publicações da diária andam para frente.
 *
 *  As datas estavam erradas: as publicações venciam ANTES da gravação que as
 *  originou. 14 e não 7 porque o pedido foi "mais de uma semana", e duas semanas
 *  preservam o espaçamento relativo entre as peças enquanto jogam todas para depois
 *  de 17/09. `start_date`/`end_date` andam junto quando existem — deslocar só o
 *  `due_date` deixaria a janela do card invertida. */
const DESLOCAR_DIAS = 14;

/** A diária de 17/09 e as três peças que saíram dela. Roteiro e captação são os
 *  MESMOS cards nas três Entregas — modelo de bloco compartilhado.
 *
 *  A conta fecha sem invenção: tirando o Feed, a publicação avulsa e o "Post evento
 *  26/09" (que preenche o slot vago acima), sobram exatamente três publicações — e a
 *  captação se chama "Gravação 17/09 — 3 publicações". */
const DIARIA_17_09 = {
  roteiro: "02954165-13bf-5a44-9811-a3de54cd7d80",  // Roteiros da diária 17/09
  captacao: "56a6b5ea-7c05-5095-86e0-86f94860747a", // Gravação 17/09 — 3 publicações
  publicacoes: [
    { card: "dce78cc2-9736-46c1-bbb2-1ebe53a8a387", nota: "Publicação post Evento — vencia 06/09, antes da gravação" },
    { card: "fafaf36a-8d7c-468b-8363-ab515d94a999", nota: "Post evento 19/09 — vencia 13/09, antes da gravação" },
    // A terceira peça. A descrição a identifica sem ambiguidade: "Posta VÍDEO do
    // motivo do estresse. Mencionando O EVENTO DO FINAL DE SEMANA na legenda e se
    // couber, também no vídeo." Vídeo é reels (a regra da gravação vale), fala do
    // mesmo evento das outras duas, e vence antes da gravação — o mesmo padrão de
    // data errada. É ela que fecha as 3 publicações do título da captação.
    { card: "fea9aae7-8d25-44ac-aab0-9250fa87df80", nota: "Postagem motivo do estresse — vídeo sobre o evento; vencia 09/09, antes da gravação" },
  ],
};

/** Cards cujo `subtype` está errado e é corrigido aqui.
 *
 *  "Post jogando pratos novos" é a MESMA peça que "REELS FEED - Jogando pratos
 *  novos" (já ligado ao Plano de Agosto) — um reels só, ainda não publicado. Como os
 *  outros cards dessa peça não existem, ela não compõe Entrega: fica como task de
 *  edição, solta. Tirá-la daqui não quebrou a conta das 3 publicações — o lugar dela
 *  era ocupado por "Postagem motivo do estresse", que a descrição identifica como
 *  vídeo sobre o mesmo evento. */
const AJUSTAR_SUBTYPE = [
  { card: "19405746-eeb2-4ce6-b6cd-655e8132686c", de: null, para: "edicao", porque: "mesma peça de 'REELS FEED - Jogando pratos novos'; sem os outros cards, não compõe Entrega" },
];

/** Ficam SOZINHOS, sem Entrega. Listados para o relatório dizer que a decisão foi
 *  deliberada, e não esquecimento. */
const SEM_ENTREGA = [
  ["1684c4a4-bb60-4c49-ac5b-15c2f1acdcbe", "Post Feed agenda Mês Setembro", "Feed/carrossel — a própria descrição diz 'Postar em formato Carrossel'; não sai de gravação"],
  ["1e3260fc-ae42-4bc8-a90a-7195f0cec3bf", "Dia do Consumidor", "edição de card promocional ('promoções ativas no Dia do Consumidor'), sem relação com as peças do evento"],
  ["049c13ad-dcd1-45ea-9a92-fb4523758f17", "DIVULGAÇÃO EVENTO - 12/09", "evento de 12/09, marcado 'finalizado' em comentário"],
  ["19405746-eeb2-4ce6-b6cd-655e8132686c", "Post jogando pratos novos", "um reels só, ainda não publicado; mesma peça de 'REELS FEED - Jogando pratos novos'. Sem os outros cards não compõe Entrega — fica como task de edição (ver AJUSTAR_SUBTYPE)"],
];

const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
const maisDias = (v, n) => {
  const d = new Date(v);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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
  console.log(`   roteiro  compartilhado: "${roteiro.title}"  (${dia(roteiro.due_date)})`);
  console.log(`   captação compartilhada: "${captacao.title}"  (${dia(captacao.due_date)})`);

  const pecas = [];
  for (const p of DIARIA_17_09.publicacoes) {
    const pub = await card(p.card);
    if (!pub) { console.log(`\n   ! card ${p.card} não existe — pulado`); continue; }
    const novaData = maisDias(pub.due_date, DESLOCAR_DIAS);
    console.log(`\n   Entrega a criar: "${pub.title}"`);
    console.log(`     publicação ${dia(pub.due_date)} → ${novaData}   (+${DESLOCAR_DIAS} dias)`);
    console.log(`     ${p.nota}`);
    console.log(`     roteiro    ← ${roteiro.title}   [compartilhado]`);
    console.log(`     captacao   ← ${captacao.title}  [compartilhado]`);
    console.log(`     edicao     ← vago`);
    console.log(`     publicacao ← ${pub.title}`);
    pecas.push({ pub, novaData });
  }
  // O título da captação diz "3 publicações" e as três têm card. A peça que sobrava
  // ("jogando pratos") era a mesma de um card já ligado ao Plano de Agosto — por isso
  // ela saiu daqui e virou edição solta, sem quebrar a conta.
  console.log(`
   ${pecas.length} Entrega(s) da diária — bate com as 3 publicações do título da captação.`);

  // ---- 2b. corrigir subtype -------------------------------------------------
  console.log(`\n2b. CORRIGIR SUBTYPE`);
  const ajustes = [];
  for (const a of AJUSTAR_SUBTYPE) {
    const c = await card(a.card);
    if (!c) { console.log(`   ! card ${a.card} não existe — pulado`); continue; }
    if (c.subtype === a.para) { console.log(`   já está como ${a.para}: ${c.title}`); continue; }
    console.log(`   ${c.title}:  subtype ${c.subtype ?? "—"} → ${a.para}`);
    console.log(`     ${a.porque}`);
    ajustes.push({ id: c.id, para: a.para, title: c.title });
  }

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
    for (const a of ajustes) {
      const { rowCount } = await db.query(
        `update public.tasks set subtype = $2 where id = $1::uuid returning id`, [a.id, a.para]);
      console.log(rowCount === 1 ? `ok: subtype de "${a.title}" → ${a.para}` : `! subtype de "${a.title}" não mudou`);
    }

    for (const l of paraLigar) {
      const { rowCount } = await db.query(`
        insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
        values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)
        on conflict do nothing returning parent_id`, [l.parent, l.child, l.step]);
      console.log(rowCount === 1 ? `ok: ligado ${l.etapa}` : `já existia: ${l.etapa}`);
    }

    for (const { pub, novaData } of pecas) {
      // A data anda ANTES de a Entrega nascer: a Entrega herda o vencimento da
      // publicação, e nascer com a data velha a deixaria atrasada de saída.
      await db.query(`
        update public.tasks
           set due_date = $2::date,
               start_date = case when start_date is null then null else $2::date end,
               end_date = case when end_date is null then null else greatest($2::date, end_date) end
         where id = $1::uuid`, [pub.id, novaData]);

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
        [CLIENTE, pub.title, novaData, captacao.reviewer_id, DELIVERY_TYPE, WORKFLOW]);
      const entregaId = nova[0].id;

      for (const [etapa, filho] of [["roteiro", DIARIA_17_09.roteiro], ["captacao", DIARIA_17_09.captacao], ["publicacao", pub.id]]) {
        await db.query(`
          insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
          values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)
          on conflict do nothing`, [entregaId, filho, stepId(etapa)]);
      }
      console.log(`ok: Entrega "${nova[0].title}" (${entregaId}) — publicação em ${novaData}, roteiro e captação compartilhados`);
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
