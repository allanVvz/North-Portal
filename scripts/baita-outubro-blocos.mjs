// Fase 2 (bloco): estrutura as 8 peças de "PLANO DE CONTEÚDO - OUTUBRO" em
// Entregas — 6 Reels + 2 anúncios.
//
// As 9 atividades do plano (Roteiro do bloco — 6 Reels, Gravação do bloco — 6
// Reels, Edição — 6 Reels, e o mesmo trio para 2 anúncios, mais Aprovação/
// Publicação em lote) já descrevem o bloco — são membros de "PLANO DE CONTEÚDO
// - OUTUBRO", confirmado em produção. O que falta é a PEÇA: cada Reels e cada
// anúncio vira sua própria Entrega, compartilhando roteiro/captação/edição do
// bloco (o mesmo material, roteirizado e gravado uma vez, editado uma vez,
// publicado várias).
//
// Os 8 nomes vêm do documento "ROTEIROS BAITA - SETEMBRO"
// (https://docs.google.com/document/d/1aAaJI53PNaCyW6QcFCdx6j5n7I71ke3l_N0BehjNAHk),
// que a Cintia linkou no comentário do próprio card "Roteiro do bloco — 6
// Reels" ("Todos os roteiros estão com OK"). O documento marca cada roteiro
// aprovado com o prefixo "ok" — são exatamente 8, e se dividem em 6
// reels-narrativa + 2 "Anúncio", batendo com o tamanho dos dois blocos. As
// descrições abaixo são o texto do roteiro, não inventado.
//
// `task_links` é único por (parent_id, child_id) e (parent_id,
// workflow_step_id), nunca por child_id: o mesmo card de roteiro/captação/
// edição é etapa das 6 (ou 2) Entregas sem ser duplicado.
//
// Uso: node scripts/baita-outubro-blocos.mjs [--apply]

import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const APPLY = process.argv.includes("--apply");

const SLUG = "baita-conveniencia";
const PLANO = "7e1a162d-ff0f-414e-ad50-bea8b472fbcd"; // PLANO DE CONTEÚDO - OUTUBRO

/** Bloco de 6 Reels: roteiro/captação/edição compartilhados, publicação
 *  em 26/09 (mesma data de "Publicação — 6 conteúdos", o lote). */
const BLOCO_REELS = {
  roteiro: "b3dcd896-4e05-414a-bc89-8748e82067f0",  // Roteiro do bloco — 6 Reels
  captacao: "0f18c00f-69b6-4c94-9223-4284fe67dea4", // Gravação do bloco — 6 Reels
  edicao: "8393b20d-81e3-4b9d-8731-750bc3fb0ae3",   // Edição — 6 Reels
  vence: "2026-09-26",
  pecas: [
    {
      titulo: "Divulgação Evento — Dia do Cliente",
      descricao: "Ref: https://www.instagram.com/reel/Db3I3MxN2jN/?stkn=bTZsMnY3OGNibGVl\n\nPromo Especial - Dia do Cliente 15/09. Todas as promos da Casinha em 1 só dia, para quem é fã da Baita!",
    },
    {
      titulo: "Promoções da Semana",
      descricao: "Ref: https://www.instagram.com/reel/DcQqPUuEcCq/?stkn=MXF4dHR5djZ5eHYxaQ==\n\n2 litrão Amstel - SEGUNDA. Mascate abrindo e brindando.\n\nPromo de latão de Heineken - TERÇA: https://www.instagram.com/reel/DbYR3nCx1aP/?stkn=YWZrcWx3ZHZjMmJ5\n\nTakes clientes provando Caipa - PROMO QUARTA.\n\n-> Versão das promos sendo preparadas para delivery",
    },
    {
      titulo: "Não é Todo Mundo",
      descricao: "Vídeo com Kaoma e óculos escuros. Começa lá dentro arrumando algo na prateleira, coloca o óculos e sai até a calçada, mostrando fachada da Baita.\n\nReferência: https://www.instagram.com/p/DYm92HeR5ri/\n\nFrase na tela: Não é todo mundo de Novo Hamburgo que vem curtir o happy hour da Baita. E tá tudo bem… As pessoas cometem erros.",
    },
    {
      titulo: "Dicas para Aproveitar um Rolê na Baita",
      descricao: "Vídeo da Kaoma falando para a câmera. Cada parte do texto ela fala em um ponto diferente da Baita, trazendo variações — um guia, ela pode falar do jeito dela.\n\nReferência: https://www.instagram.com/p/Db_OikMvEuk/\n\n'Recorte de uma fala impactante da Kaoma' - livre para ver o que vier espontaneamente. Roteiro completo (fala guiada) no documento de roteiros, linkado no card 'Roteiro do bloco — 6 Reels'.",
    },
    {
      titulo: "Paz de Espírito",
      descricao: "Referência: https://www.instagram.com/p/DXfFMGREugJ/\n\nCintia sentada, Kaoma em pé. Opções de frase na tela:\n\"quando a semana foi intensa e desalinhou meu chacras\"\n\"como manter a paz de espirito morando em Novo Hamburgo\"",
    },
    {
      titulo: "Cliente Passando Cartão",
      descricao: "Ref: https://www.instagram.com/reel/Dc0gbIAAoPn/?stkn=MWQxZXZodTgzNjJpMg==\n\nÀs vezes tudo que tu precisa é de um empurrãozinho, para provar as porções da Casinha.",
    },
  ],
};

/** Bloco de 2 anúncios: roteiro/captação/edição compartilhados, publicação em
 *  28/09 (mesma data de "Aprovação do cliente — 2 conteúdos" — não há uma
 *  "Publicação — 2 conteúdos" própria no plano; mídia paga costuma entrar em
 *  veiculação assim que aprovada). */
const BLOCO_ANUNCIOS = {
  roteiro: "fb6ec068-84e2-4538-a6a3-022e244cd3eb",  // Roteiro do bloco — 2 anúncios
  captacao: "eae097f0-b30e-4a4b-ad36-3a6a8d22d18a", // Gravação do bloco — 2 anúncios
  edicao: "d9f87cf5-3437-4797-98cf-44818d03ffa2",   // Edição — 2 anúncios
  vence: "2026-09-28",
  pecas: [
    {
      titulo: "Anúncio — Ainda Não Tá Sabendo do Rolê",
      descricao: "Ainda não tá sabendo do rolê do final de semana? Vai ser na Baita, com DJ, promoções, música boa e a vibe aconchegante de sempre. Chama a tua galera e vem pra Baita!",
    },
    {
      titulo: "Anúncio — Esse Final de Semana Tem Rolê",
      descricao: "Esse final de semana tem rolê na Baita! DJ, promoções, foodtruck e esse clima gostoso da Casinha. Vem curtir uma música boa com a galera. Começa às 17h, chega cedo.",
    },
  ],
};

const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows: cli } = await db.query("select id from public.clients where slug = $1", [SLUG]);
  if (!cli.length) throw new Error(`Cliente ${SLUG} não encontrado.`);
  const CLIENTE = cli[0].id;

  const { rows: plano } = await db.query("select id, title from public.tasks where id = $1::uuid and kind = 'plano_acao'", [PLANO]);
  if (!plano.length) throw new Error(`Plano ${PLANO} não encontrado ou não é plano_acao.`);
  console.log(`\nPlano: "${plano[0].title}"  (${PLANO})`);

  // Workflow e ids de etapa vêm do banco, nunca fixados aqui.
  const { rows: wf } = await db.query(`
    select v.id, v.delivery_type_id, s.id as step_id, s.task_type_id, tt.key as etapa, s.order_index
    from public.workflow_versions v
    join public.workflow_version_steps s on s.workflow_version_id = v.id
    join public.task_types tt on tt.id = s.task_type_id
    where v.status = 'published' and v.label ilike 'criativo%'
    order by s.order_index`);
  if (!wf.length) throw new Error("Workflow publicado de Criativo não encontrado.");
  const WORKFLOW = wf[0].id;
  const DELIVERY_TYPE = wf[0].delivery_type_id;
  const step = (etapa) => {
    const hit = wf.find((s) => s.etapa === etapa);
    if (!hit) throw new Error(`Etapa "${etapa}" não existe no workflow publicado.`);
    return hit;
  };
  const stepId = (etapa) => step(etapa).step_id;

  // `task_type_id` é a fonte da verdade de kind/subtype — a trigger
  // `tasks_project_task_type` (migração 20260917120000) DERIVA kind/subtype dele
  // em todo insert/update que toque numa dessas 3 colunas, e sobrescreve
  // silenciosamente o que for passado direto. Não dá pra criar a task de
  // publicação com `kind: 'operacional', subtype: 'publicacao'` — precisa do
  // task_type_id do tipo "publicacao" (filho de "tarefa"), lido do banco.
  const { rows: tt } = await db.query(`
    select subtype.id from public.task_types subtype
    join public.task_types parent on parent.id = subtype.parent_id
    where parent.key = 'tarefa' and subtype.key = 'publicacao'`);
  if (!tt.length) throw new Error("task_type 'publicacao' (filho de 'tarefa') não encontrado.");
  const PUBLICACAO_TYPE = tt[0].id;

  const card = async (id) => {
    const { rows } = await db.query(
      `select id, title, due_date, reviewer_id, task_type_id, kind, subtype, status, completed_at is not null as concluida
         from public.tasks where id = $1::uuid`, [id]);
    return rows[0] ?? null;
  };

  console.log(`Workflow: ${WORKFLOW}  (${wf.map((s) => s.etapa).join(" → ")})\n`);

  const planejar = async (bloco, nomeBloco) => {
    const roteiro = await card(bloco.roteiro);
    const captacao = await card(bloco.captacao);
    const edicao = await card(bloco.edicao);
    if (!roteiro || !captacao || !edicao) throw new Error(`Etapa compartilhada de ${nomeBloco} não encontrada.`);

    console.log(`${nomeBloco} — ${bloco.pecas.length} peça(s), vence ${bloco.vence}`);
    // Os 3 cards compartilhados nasceram pelo composer genérico de "Plano de
    // conteúdo" (PlanAddCombobox.tsx), que crava toda etapa como
    // `kind: 'operacional'` SEM subtype — task_type_id aponta pra raiz "tarefa".
    // Pra virar etapa de workflow, o child precisa do task_type_id EXATO que a
    // etapa declara (trigger task_link_matches_workflow_version, migração
    // 20260917120000): não basta a chave bater, tem que ser o mesmo id.
    for (const [nome, c, etapa] of [["roteiro", roteiro, "roteiro"], ["captação", captacao, "captacao"], ["edição", edicao, "edicao"]]) {
      const esperado = step(etapa).task_type_id;
      const okAgora = c.task_type_id === esperado;
      console.log(`  ${nome.padEnd(9)} compartilhado: "${c.title}"  (${dia(c.due_date)})  ${okAgora ? "[tipo já correto]" : `[subtype ${c.subtype ?? "—"} → ${etapa}]`}`);
    }
    // Mesma regra do trigger `workflow_link_is_strictly_sequential`: publicacao
    // (order 40) só pode ser linkada se edicao (order 30) já estiver concluída.
    // "Edição — 6 Reels" e "Edição — 2 anúncios" estão `backlog` hoje — nenhuma
    // das 8 Entregas ganha a etapa de publicação vinculada nesta rodada.
    const edicaoPronta = edicao.concluida;
    for (const p of bloco.pecas) {
      console.log(`\n  Entrega a criar: "${p.titulo}"`);
      console.log(`    roteiro    ← ${roteiro.title}   [compartilhado]`);
      console.log(`    captacao   ← ${captacao.title}  [compartilhado]`);
      console.log(`    edicao     ← ${edicao.title}    [compartilhado]`);
      console.log(edicaoPronta
        ? `    publicacao ← nova task, vence ${bloco.vence}, vinculada como etapa`
        : `    publicacao ← nova task, vence ${bloco.vence}  ⚠ NÃO vinculada — edição ainda "${edicao.status}"`);
    }
    console.log("");
    return { roteiro, captacao, edicao, edicaoPronta };
  };

  const reels = await planejar(BLOCO_REELS, "1. BLOCO 6 REELS");
  const anuncios = await planejar(BLOCO_ANUNCIOS, "2. BLOCO 2 ANÚNCIOS");

  const totalEntregas = BLOCO_REELS.pecas.length + BLOCO_ANUNCIOS.pecas.length;
  console.log(`Total: ${totalEntregas} Entregas, todas membros de "${plano[0].title}".`);

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Rode com --apply.\n");
    process.exit(0);
  }

  await db.query("begin");
  try {
    // Corrige o tipo dos 3 cards compartilhados de um bloco, UMA vez (não por
    // peça — são os mesmos 3 cards em todas as Entregas do bloco). Sem isso,
    // `task_link_matches_workflow_version` recusa o link: "workflow child has
    // an incompatible Task subtype" — o child precisa do MESMO task_type_id
    // que a etapa declara, não só a chave batendo.
    const corrigirTipoCompartilhado = async (partes) => {
      for (const [etapa, c] of [["roteiro", partes.roteiro], ["captacao", partes.captacao], ["edicao", partes.edicao]]) {
        const esperado = step(etapa).task_type_id;
        if (c.task_type_id === esperado) continue;
        const { rows } = await db.query(
          `update public.tasks set task_type_id = $2::uuid where id = $1::uuid returning kind, subtype`,
          [c.id, esperado]);
        if (rows[0].subtype !== etapa) {
          throw new Error(`task_type_id de "${c.title}" projetou subtype inesperado: ${JSON.stringify(rows[0])}`);
        }
        console.log(`ok: "${c.title}" tipado como ${etapa}`);
      }
    };

    // Toda Entrega nova nasce com workflow_version_id preenchido, e a trigger
    // `tasks_materialize_first_workflow_step` (AFTER INSERT on tasks, migração
    // 20260917120000) dispara na hora e MATERIALIZA sozinha um card em branco
    // pra primeira etapa do workflow (aqui, roteiro): cria a task e já a linka
    // via `task_links ... on conflict (parent_id, child_id) do update`. O
    // índice único é por (parent_id, workflow_step_id) — então quando este
    // script tenta inserir o link da etapa real logo depois, `on conflict do
    // nothing` bate nesse índice e é ENGOLIDO em silêncio, deixando o
    // placeholder (backlog, sem completed_at) na vaga do roteiro. A etapa
    // seguinte (captação) então falha "every previous step is complete",
    // porque o roteiro "linkado" é o placeholder vazio, não o card real.
    // Correção: reaponta o link já existente pro card real e apaga o
    // placeholder órfão, em vez de tentar inserir um segundo link na mesma
    // vaga.
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

    const criarBloco = async (bloco, partes) => {
      await corrigirTipoCompartilhado(partes);
      for (const p of bloco.pecas) {
        // kind/subtype NÃO são passados — a trigger os deriva de task_type_id.
        // Passá-los aqui seria redundante na melhor hipótese e enganoso na pior
        // (o valor escrito não é necessariamente o que fica gravado).
        const { rows: pubRows } = await db.query(`
          insert into public.tasks (
            client_id, title, description, status, priority, assignee,
            due_date, start_date, end_date, position, client_visible, progress_weight,
            requires_review, requires_approval, task_type_id, payload
          ) values (
            $1::uuid, $2, $3, 'backlog', 'media', null,
            $4::date, $4::date, $4::date, 0, false, 1,
            true, false, $5::uuid, '{}'::jsonb
          ) returning id, kind, subtype`,
          [CLIENTE, p.titulo, p.descricao, bloco.vence, PUBLICACAO_TYPE]);
        // Confere o que a trigger realmente gravou, em vez de assumir.
        if (pubRows[0].kind !== "operacional" || pubRows[0].subtype !== "publicacao") {
          throw new Error(`task_type_id de publicacao projetou kind/subtype inesperado: ${JSON.stringify(pubRows[0])}`);
        }
        const pubId = pubRows[0].id;

        // Idempotência por TÍTULO: sem id determinístico no insert, rodar o
        // script de novo (o caminho normal pra linkar publicacao depois que a
        // edição do bloco for aprovada) não pode criar Entrega duplicada.
        const { rows: existente } = await db.query(
          `select id from public.tasks where client_id = $1::uuid and kind = 'criativo' and title = $2 limit 1`,
          [CLIENTE, p.titulo]);
        let entregaId;
        if (existente.length) {
          entregaId = existente[0].id;
          console.log(`(Entrega "${p.titulo}" já existe, ${entregaId} — reusando)`);
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
            [CLIENTE, p.titulo, bloco.vence, partes.roteiro.reviewer_id, DELIVERY_TYPE, WORKFLOW]);
          entregaId = nova[0].id;
        }

        // publicacao só entra se edicao já estiver concluída — senão o trigger
        // `task_link_matches_workflow_version`/`workflow_link_is_strictly_sequential`
        // recusa e derruba a transação inteira. O card de publicação já foi
        // corrigido acima (nome/tipo/data); só a LIGAÇÃO como etapa fica pendente.
        const etapas = [
          ["roteiro", bloco.roteiro], ["captacao", bloco.captacao], ["edicao", bloco.edicao],
          ...(partes.edicaoPronta ? [["publicacao", pubId]] : []),
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
        await db.query(`
          insert into public.task_links (parent_id, child_id, relation_kind, position)
          values ($1::uuid, $2::uuid, 'structural_member', 0)
          on conflict do nothing`, [PLANO, entregaId]);

        console.log(partes.edicaoPronta
          ? `ok: Entrega "${p.titulo}" (${entregaId}) com as 4 etapas, membro de "${plano[0].title}"`
          : `ok: Entrega "${p.titulo}" (${entregaId}) com 3 etapas — publicação PENDENTE (edição em ${partes.edicao.status}), membro de "${plano[0].title}"`);
      }
    };

    await criarBloco(BLOCO_REELS, reels);
    await criarBloco(BLOCO_ANUNCIOS, anuncios);

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
