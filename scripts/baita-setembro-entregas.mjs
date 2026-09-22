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
// A primeira tentativa de --apply falhou (rollback confirmado, nada gravado):
// "A workflow step may only be linked after every previous step is complete"
// (trigger workflow_link_is_strictly_sequential, migração 20260918004358). É
// regra real, não bug — a etapa de EDIÇÃO compartilhada ("Evento Baita 10/10 —
// Edição") ainda está `em_producao`, não `aprovado`, então NENHUMA Entrega
// (nem a antiga "Evento Baita 26/09", nem as 2 novas) pode ter a etapa de
// publicação vinculada agora. O script passa a criar as 2 Entregas com
// roteiro+captação+edição linkados (os três já estão liberados) e deixa
// publicação PENDENTE — a etapa fica vaga, o card de publicação é corrigido
// mesmo assim (nome/subtype/data não dependem do trigger), e rodar o script de
// novo depois que alguém aprovar a edição linka o que falta, sem duplicar
// Entrega: como o insert da Entrega não usa id determinístico, a idempotência
// é por TÍTULO — se já existe uma "Evento Baita 10/10 — Reels"/"Carrossel", o
// script reusa o id em vez de criar outra.
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

  // `task_type_id` é a fonte da verdade de kind/subtype — a trigger
  // `tasks_project_task_type` (migração 20260917120000) DERIVA as duas colunas
  // dele em todo insert/update que as toque, e sobrescreve silenciosamente o
  // que for passado direto. Um `update ... set subtype = 'publicacao'` sem tocar
  // task_type_id não teria funcionado: a trigger relê o task_type_id (a raiz
  // "tarefa", sem subtipo) e reescreve subtype de volta para null — a mesma
  // classe de bug que travou scripts/baita-outubro-blocos.mjs, só que sem
  // erro nenhum aparecer, porque a trigger não recusa, só ignora.
  const { rows: tt } = await db.query(`
    select subtype.id from public.task_types subtype
    join public.task_types parent on parent.id = subtype.parent_id
    where parent.key = 'tarefa' and subtype.key = 'publicacao'`);
  if (!tt.length) throw new Error("task_type 'publicacao' (filho de 'tarefa') não encontrado.");
  const PUBLICACAO_TYPE = tt[0].id;

  const card = async (id) => {
    const { rows } = await db.query(
      `select id, title, kind, subtype, status, due_date, reviewer_id, completed_at is not null as concluida
         from public.tasks where id = $1::uuid`, [id]);
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

  // A publicação só pode ser linkada como etapa se a edição JÁ estiver
  // completa — é a regra do trigger. Checado uma vez, vale para as 2 Entregas
  // porque as duas compartilham a mesma edição.
  const edicaoPronta = edicao.concluida;

  const criar = [];
  for (const p of PECAS) {
    const pub = await card(p.card);
    if (!pub) { console.log(`   ! ${p.card} não existe — pulado`); continue; }
    console.log(`\n   Entrega: "${p.entrega}"   (vence ${EVENTO})`);
    console.log(`     roteiro    ← ${roteiro.title}   [compartilhado]`);
    console.log(`     captacao   ← ${captacao.title}  [compartilhado]`);
    console.log(`     edicao     ← ${edicao.title}    [compartilhado]`);
    console.log(`     publicacao ← "${pub.title}" → "${p.publicacao}"`);
    console.log(`                  subtype ${pub.subtype ?? "—"} → publicacao (via task_type_id), vence — → ${EVENTO}`);
    console.log(edicaoPronta
      ? `                  vinculada como etapa (edição concluída)`
      : `                  ⚠ NÃO vinculada como etapa agora: edição ainda "${edicao.status}" — card só é corrigido, etapa fica vaga`);
    console.log(`     plano      ← Tarefas do mes de setembro`);
    criar.push({ ...p, pub });
  }

  console.log("\n3. FORA DESTA RODADA — precisa de decisão");
  console.log(`   Bloco 6 Reels e bloco 2 anúncios: ver scripts/baita-outubro-blocos.mjs.`);
  console.log(`   "Gravação 17/09 — 3 publicações" (solta) pode ser a mesma diária de`);
  console.log(`   "Gravação do bloco — 6 Reels" (16/09, no plano) — confirmar antes de usar.`);
  console.log(`   "Post evento 26/09" (2d3dff22…) e o slot vago de publicação da Entrega`);
  console.log(`   EXISTENTE "Evento Baita 26/09" (e0b23dce…) não são tocados aqui — essa era`);
  console.log(`   uma suposição de uma rodada anterior, anterior a você apontar os 2 cards`);
  console.log(`   certos (reels/carrossel). Confirmar se esse card e essa Entrega antiga ainda`);
  console.log(`   servem para algo, ou se ficaram obsoletos com as 2 Entregas novas.`);

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  // Toda Entrega nova nasce com workflow_version_id preenchido, e a trigger
  // `tasks_materialize_first_workflow_step` (AFTER INSERT on tasks, migração
  // 20260917120000) dispara na hora e MATERIALIZA sozinha um card em branco
  // pra primeira etapa do workflow (roteiro): cria a task e já a linka via
  // `task_links ... on conflict (parent_id, child_id) do update`. O índice
  // único é por (parent_id, workflow_step_id) — quando este script tenta
  // inserir o link da etapa real logo depois, `on conflict do nothing` bate
  // nesse índice e é ENGOLIDO em silêncio, deixando o placeholder (backlog,
  // sem completed_at) na vaga do roteiro. A etapa seguinte (captação) então
  // falha "every previous step is complete", porque o roteiro "linkado" é o
  // placeholder vazio, não o card real. Correção: reaponta o link existente
  // pro card real e apaga o placeholder órfão, em vez de inserir um segundo
  // link na mesma vaga.
  const primeiraEtapa = wf[0].etapa;
  const vincularPrimeiraEtapa = async (entregaId, realId, etapa) => {
    const { rows } = await db.query(
      `select child_id from public.task_links
         where parent_id = $1::uuid and workflow_step_id = $2::uuid and relation_kind = 'workflow_step'`,
      [entregaId, stepId(etapa)]);
    const atual = rows[0]?.child_id;
    if (atual === realId) return; // reuso idempotente, já correto
    if (!atual) {
      await db.query(`
        insert into public.task_links (parent_id, child_id, relation_kind, workflow_step_id, position)
        values ($1::uuid, $2::uuid, 'workflow_step', $3::uuid, 0)`, [entregaId, realId, stepId(etapa)]);
      return;
    }
    await db.query(`
      update public.task_links set child_id = $3::uuid
        where parent_id = $1::uuid and workflow_step_id = $2::uuid`,
      [entregaId, stepId(etapa), realId]);
    await db.query(`delete from public.tasks where id = $1::uuid`, [atual]);
    console.log(`  (placeholder da 1ª etapa substituído pelo card real; órfão ${atual} apagado)`);
  };

  await db.query("begin");
  try {
    for (const r of renomear) {
      await db.query("update public.tasks set title = $2 where id = $1::uuid", [r.id, r.para]);
      console.log(`ok: renomeado → "${r.para}"`);
    }

    for (const c of criar) {
      // O card de publicação é corrigido ANTES de a Entrega nascer: nome,
      // task_type_id (→ subtype "publicacao" via trigger) e data.
      const { rows: pubUpd } = await db.query(
        `update public.tasks set title = $2, task_type_id = $3::uuid, due_date = $4::date,
                end_date = case when end_date is null then null else greatest($4::date, end_date) end
           where id = $1::uuid returning kind, subtype`, [c.pub.id, c.publicacao, PUBLICACAO_TYPE, EVENTO]);
      // Confere o que a trigger realmente gravou, em vez de assumir.
      if (pubUpd[0].kind !== "operacional" || pubUpd[0].subtype !== "publicacao") {
        throw new Error(`task_type_id de publicacao projetou kind/subtype inesperado: ${JSON.stringify(pubUpd[0])}`);
      }

      // Idempotência por TÍTULO: esta Entrega nasce por insert puro (sem id
      // determinístico), e rodar o script de novo — o caminho normal para
      // completar a publicação depois que a edição for aprovada — não pode
      // criar uma segunda Entrega. Se já existe uma com este título, reusa.
      const { rows: existente } = await db.query(
        `select id from public.tasks where client_id = $1::uuid and kind = 'criativo' and title = $2 limit 1`,
        [CLIENTE, c.entrega]);
      let entregaId;
      if (existente.length) {
        entregaId = existente[0].id;
        console.log(`(Entrega "${c.entrega}" já existe, ${entregaId} — reusando)`);
      } else {
        const { rows: nova } = await db.query(`
          insert into public.tasks (
            client_id, kind, subtype, title, status, priority, assignee,
            due_date, start_date, end_date, position, client_visible, progress_weight,
            requires_review, requires_approval, reviewer_id, task_type_id, workflow_version_id, payload
          ) values (
            $1::uuid, 'criativo', null, $2, 'backlog', 'media', null,
            $3::date, $3::date, $3::date, 0, false, 1,
            true, false, $4::uuid, $5::uuid, $6::uuid, '{}'::jsonb
          ) returning id`,
          [CLIENTE, c.entrega, EVENTO, edicao.reviewer_id, DELIVERY_TYPE, WORKFLOW]);
        entregaId = nova[0].id;
      }

      // publicacao só entra na lista se a edição já estiver completa — senão o
      // trigger `workflow_link_is_strictly_sequential` recusa o insert e derruba
      // a transação inteira. O card de publicação já foi corrigido acima
      // (nome/subtype/data); só a LIGAÇÃO como etapa fica pendente.
      const etapas = [
        ["roteiro", COMPARTILHADAS.roteiro],
        ["captacao", COMPARTILHADAS.captacao],
        ["edicao", COMPARTILHADAS.edicao],
        ...(edicaoPronta ? [["publicacao", c.pub.id]] : []),
      ];
      for (const [etapa, filho] of etapas) {
        if (etapa === primeiraEtapa) {
          await vincularPrimeiraEtapa(entregaId, filho, etapa);
          continue;
        }
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
      console.log(edicaoPronta
        ? `ok: Entrega "${c.entrega}" (${entregaId}) com as 4 etapas, membro de "Tarefas do mes de setembro"`
        : `ok: Entrega "${c.entrega}" (${entregaId}) com 3 etapas — publicação PENDENTE (edição em produção), membro de "Tarefas do mes de setembro"`);
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
