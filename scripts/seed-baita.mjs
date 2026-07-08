// Seeds real, non-fake data for the Baita Conveniência client, sourced from
// docs/Baita/ (briefing, contract, roteiros, and the design/video task
// inventory). Idempotent-ish: briefing/central content are upserted, plan
// tasks and checkpoints are only inserted if none exist yet for this client.
//
// Usage: node scripts/seed-baita.mjs
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// .env.local (same pattern as scripts/create-user.mjs).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* .env.local optional */
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const SLUG = "baita-conveniencia";

async function main() {
  const { data: clients, error } = await supabase.from("clients").select("id,slug,name").eq("slug", SLUG).limit(1);
  if (error) throw error;
  const client = clients?.[0];
  if (!client) throw new Error(`Client "${SLUG}" not found — run supabase/seed.sql first.`);
  console.log(`Seeding real Baita data for client ${client.id} (${client.name})`);

  await seedBriefing(client.id);
  await seedCentralContent(client.id);
  await seedCheckpoints(client.id);
  await seedPlans(client.id);

  console.log("Done.");
}

// ---- 1. Briefing — from BAITA - Base de Conhecimento Marketing.md / Extracao Bruta -----

// The wizard stores one answer PER QUESTION, keyed `${cardKey}_q${n}` (1-indexed,
// matching app/[slug]/content.ts briefSteps question order) — NOT one paragraph
// per card. Every key below maps to a real question the wizard actually renders.
async function seedBriefing(clientId) {
  const answers = {
    // Card: História da empresa (b1_historia) — 5 questions
    b1_historia_q1: "Começou na pandemia: os sócios eram do mesmo grupo de amigos e, nesse período, identificaram a oportunidade de mercado na região.",
    b1_historia_q3: "Minimercado/conveniência com bebidas (do isopor ao vinho branco), petiscos, combos, delivery e eventos com DJs — ponto de encontro da praça, do minimercado ao rolê de Novo Hamburgo.",
    b1_historia_q4: "Oportunidade de mercado identificada pelos sócios durante a pandemia, a partir de reuniões que evoluíram de virtuais para presenciais na Praça Dimelo.",
    b1_historia_q5: "\"Foi com um isopor e um sonho que eles abriram a loja\", numa pegada de minimercado — até virar o point da galera: parada estratégica de quem termina o treino na praça ou busca um happy hour com os colegas.",

    // Card: Quem somos (b1_quem) — 6 questions
    b1_quem_q1: "Conectar pessoas — acolhimento de todos os públicos, respeito mútuo, escuta ativa e proximidade real com o cliente.",
    b1_quem_q3: "Clima de casinha, proximidade da equipe (parte dela também já foi cliente, trazendo essa perspectiva pras decisões), pôr do sol e a Praça Dimelo como parte da experiência.",
    b1_quem_q4: "Acessível para vários bolsos, grande variedade de produto e conforto (até tomada para celular).",
    b1_quem_q5: "Maria, Gustavo e Bruno — sócios do mesmo grupo de amigos.",

    // Card: Metas (b2_metas) — 3 questions
    b2_metas_q1: "Aumentar visualizações, buscar faturamento, chamar para a Baita e captar clientes.",

    // Card: Cliente ideal (b3_cliente) — 3 questions
    b3_cliente_q1: "\"Todes\", com atenção especial aos skatistas da Praça Dimelo — galera do happy hour, clientes de delivery (especialmente em dias de chuva), público de eventos com DJs e quem busca conveniência rápida.",
    b3_cliente_q2: "Drinks — maior margem e foco de visibilidade no momento (Xeque Mate segue como maior volume de vendas).",

    // Card: Diferenciais (b4_dif) — 3 questions
    b4_dif_q1: "Clima casinha, acolhedor e respeitoso com todos, acessível para públicos e bolsos diferentes, grande variedade de produto, pôr do sol e a Praça Dimelo como ativos de ambiente, equipe próxima dos clientes.",

    // Card: Concorrência (b5_conc) — 2 questions
    b5_conc_q1: "Leme, RedLight e a conveniência da General Osório (Easy).",

    // Card: Identidade (b6_identidade) — 3 questions
    b6_identidade_q1: "Sim, em ajuste — orientação de remover \"Mini mercado\" do logo e simplificar a tipografia.",
    b6_identidade_q2: "Funcionários podem aparecer (autorização de uso de imagem prevista em contrato) — equipe tranquila com isso.",
    b6_identidade_q3: "Como o rolê acessível, acolhedor e respeitoso de Novo Hamburgo.",

    // Card: Tom de voz (b6_tom) — 2 questions
    b6_tom_q1: "Descontraído, informal, próximo, com gírias e brincadeiras entre palavras, aberto a memes. Ácido quando fizer sentido nos stories, mas sempre com humor de comunidade.",

    // Card: Mídia paga (b7_midia) — 3 questions
    b7_midia_q1: "Verba mensal a definir com a North.",
    b7_midia_q2: "Reforçar a comunicação e captar clientes — escopo contratado inclui gestão de tráfego pago com acompanhamento semanal e um criativo direcionado por semana.",
    b7_midia_q3: "Tráfego pago ainda não estruturado — até aqui só impulsionavam posts de eventos pontualmente.",

    // Card: Atendimento (b8_atend) — 2 questions
    b8_atend_q2: "Bebidas (cerveja, chopp, litrão, vinho, destilados), drinks autorais, petiscos doces e salgados, combos, conveniência/minimercado, tabacaria e delivery.",

    // Card: Objeções e ofertas (b9_ofertas) — 2 questions
    b9_ofertas_q2: "Sim — promoções diárias específicas por dia da semana (ex.: caipira em dobro às quartas, promoções especiais em dias de jogo).",

    // Card: Relacionamento (b10_rel) — 3 questions
    b10_rel_q2: "Sim, no delivery — mandam um cartão com QR code para avaliação no Google e feedback de delivery.",
    b10_rel_q3: "Possíveis novidades em avaliação: coco leve com frutas, gelo com sabor amora e abacaxi, anéis de cebola e nuggets.",

    // Card: Observações finais (b12_obs) — 2 questions
    b12_obs_q1: "Dia mais fraco no presencial: sábado. Delivery cresce em dias de chuva. Movimento cai depois do dia 20 do mês. Inverno é o período mais baixo do ano.",
    b12_obs_q2: "Aniversário da Baita em 16/05 (4 anos).",
  };
  const { error } = await supabase.from("briefing_answers").update({ answers, submitted: true }).eq("client_id", clientId);
  if (error) throw error;
  console.log("Briefing: respostas reais gravadas (formato por-pergunta).");
}

// ---- 2. Central Comercial — from BAITA - CONTRATO NORTH&CLIENTE.docx -------------------

async function seedCentralContent(clientId) {
  const central = {
    plan: {
      name: "Social Media + Tráfego Pago",
      price: "R$ 2.450",
      per: "/mês",
      status: "Ativo",
      payment: "Pagamento em dia",
      term: "Contrato vigente de 05 mar 2026 a 05 mar 2027 · sem renovação automática · cliente desde março/2026",
    },
    scope: [
      { title: "Diária de captação mensal", desc: "Produção dos conteúdos do calendário de publicações do mês" },
      { title: "Funil de vendas no Instagram", desc: "Estruturação do funil dentro do perfil" },
      { title: "Calendário editorial", desc: "Frequência, roteiros, copys, legendas e direcionamento das artes" },
      { title: "Conteúdos e criativos", desc: "Imagem única, carrossel, destaques e criativos para anúncios no Meta Ads" },
      { title: "Gestão de tráfego pago", desc: "Acompanhamento semanal e otimização" },
      { title: "Stories diários", desc: "Publicações diárias de story no Instagram" },
    ],
    // Defensive fallback only — CentralPage prefers the real checkpoint_comercial
    // cards from seedCheckpoints() below whenever they exist.
    checkpoints: [
      { title: "Assinatura de contrato", date: "05 mar 2026", status: "Concluído", tone: "green" },
      { title: "Kickoff e onboarding", date: "mar 2026", status: "Concluído", tone: "green" },
    ],
    billing: {
      status: "Em dia",
      next: { label: "Próxima fatura", date: "05 ago 2026", amount: "R$ 2.450" },
      method: "Pix",
      cycle: "Mensal · vencimento dia 05",
      responsible: "Maria Antonia Porto",
    },
    invoices: [
      { month: "Junho 2026", detail: "R$ 2.450 · venc. 05/06", status: "Pago", tone: "green" },
      { month: "Maio 2026", detail: "R$ 2.450 · venc. 05/05", status: "Pago", tone: "green" },
      { month: "Julho 2026", detail: "R$ 2.450 · venc. 05/07", status: "Pago", tone: "green" },
    ],
  };
  const { error } = await supabase.from("client_content").upsert({ client_id: clientId, data: { central } }, { onConflict: "client_id" });
  if (error) throw error;
  console.log("Central Comercial: dados reais do contrato gravados.");
}

// ---- 3. Checkpoints comerciais — real tasks from the template mold -------------------

async function seedCheckpoints(clientId) {
  const { data: existing, error: exErr } = await supabase
    .from("tasks")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "checkpoint_comercial");
  if (exErr) throw exErr;
  if (existing?.length) {
    console.log(`Checkpoints: ${existing.length} já provisionados, pulando.`);
    return;
  }

  const { data: templates, error } = await supabase
    .from("commercial_checkpoint_templates")
    .select("title,description,order_index")
    .eq("active", true)
    .order("order_index");
  if (error) throw error;
  if (!templates?.length) {
    console.log("Checkpoints: nenhum template ativo em Configurações — nada a provisionar.");
    return;
  }

  const rows = templates.map((t) => ({
    client_id: clientId,
    kind: "checkpoint_comercial",
    title: t.title,
    description: t.description,
    status: "backlog",
    client_visible: true,
    position: t.order_index * 10,
  }));
  const { data: inserted, error: insErr } = await supabase.from("tasks").insert(rows).select("id,title");
  if (insErr) throw insErr;

  // Real state: contrato assinado 05/03/2026, kickoff feito, já passaram por
  // roteiro/estratégia e pela 1ª reunião mensal de resultados (ver ATA-01).
  const doneIds = inserted.map((t) => t.id);
  if (doneIds.length) {
    const { error: updErr } = await supabase.from("tasks").update({ status: "concluido" }).in("id", doneIds);
    if (updErr) throw updErr;
  }
  console.log(`Checkpoints: ${inserted.length} provisionados e marcados concluídos (cliente maduro, contrato desde mar/2026).`);
}

// ---- 4. Múltiplos Planos de Ação — real campaigns from BAITA - Tarefas Design e Videos.md

const DRIVE = (id) => `https://drive.google.com/drive/folders/${id}`;

const PLANS = [
  {
    title: "Campanha Copa do Mundo 2026",
    desc: "TV sempre ligada nos jogos, chopp em dobro nos jogos do Brasil, combos especiais e stories com a promo do dia.",
    position: 10,
    members: [
      { title: "BAITA - Carrossel - JOGO COPA", kind: "criativo", status: "aprovacao", link: DRIVE("14fk0asXkJD2Dm5S1FmOdO5hkRnjCYh1Z") },
      { title: "Baita - 3 Reels - Copa", kind: "criativo", status: "em_producao", link: DRIVE("1vymfH6vUscD74vtwQjtW1MHAHDvSlTlT") },
      {
        title: "Roteiro - Convocado pra Copa (Kaoma)",
        kind: "roteiro",
        status: "concluido",
        desc: "Kaoma em frente à Baita: \"Você acaba de ser convocado pra Copa na Baita! [...] chopp em dobro nos jogos do Brasil.\"",
      },
    ],
  },
  {
    title: "Aniversário Baita — 4 anos",
    desc: "Campanha de divulgação do aniversário de 4 anos (16/05), com estética própria reforçando a história da marca.",
    position: 20,
    members: [
      { title: "Baita - Carrossel - Aniversario de 4 anos", kind: "criativo", status: "aprovado", link: DRIVE("1DvobTa93DFwhpHZfWDQTYaAx0vYXtudT") },
      { title: "Baita - Reels - Aniversario - Aquecendo", kind: "criativo", status: "concluido", link: DRIVE("1afytYNHykGK5gR8Rftk9fdSkK0uvSSPn") },
    ],
  },
  {
    title: "Atualização de cardápio & delivery",
    desc: "Atualização do layout de cardápio e reforço do delivery, especialmente em dias de chuva.",
    position: 30,
    members: [
      { title: "BAITA - LAYOUT - Cardapio Atualização", kind: "criativo", status: "aprovado", link: DRIVE("1zKlPBZYZgHOzlTqIH_IL5w6bONidXphM") },
      { title: "Baita - Reels - 11 Delivery montando sacola", kind: "criativo", status: "concluido", link: DRIVE("1Y029V2oN67XuMye0c7bXqQnWeaV9A4TD") },
    ],
  },
  {
    title: "Rotina de conteúdo — comunidade e humor",
    desc: "Pilares de comunidade, humor e prova social — reels institucionais, de produto e stories/destaques recorrentes.",
    position: 40,
    members: [
      { title: "Baita - Reels - Baita é pra quem", kind: "criativo", status: "aprovacao", link: DRIVE("1osHaqxXXQVqyn-7L5LJ43Zp-I4FJf-AE") },
      { title: "Baita - Reels - Drinks Injusticados", kind: "criativo", status: "revisao", link: DRIVE("1t-5yrNeoxPrN8sHHum5RyL2TTpyDDGPQ") },
      { title: "Baita - Destaques e Stories", kind: "criativo", status: "backlog", link: DRIVE("1TUsPPseAc70Fc8tF8QXcSnYECPDWJsEC") },
    ],
  },
];

async function seedPlans(clientId) {
  const { data: existing, error: exErr } = await supabase
    .from("tasks")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "plano_acao");
  if (exErr) throw exErr;
  if (existing?.length) {
    console.log(`Planos de Ação: ${existing.length} já existem, pulando.`);
    return;
  }

  for (const plan of PLANS) {
    const { data: planRows, error } = await supabase
      .from("tasks")
      .insert({
        client_id: clientId,
        kind: "plano_acao",
        title: plan.title,
        description: plan.desc,
        status: "em_producao",
        client_visible: true,
        position: plan.position,
      })
      .select("id")
      .limit(1);
    if (error) throw error;
    const planId = planRows[0].id;

    for (const m of plan.members) {
      const { data: memberRows, error: mErr } = await supabase
        .from("tasks")
        .insert({
          client_id: clientId,
          kind: m.kind,
          title: m.title,
          description: m.desc ?? null,
          status: m.status,
          client_visible: true,
          plan_id: planId,
        })
        .select("id")
        .limit(1);
      if (mErr) throw mErr;

      if (m.link) {
        const comments = [{ author: "North", text: `Material real (Drive): ${m.link}`, at: new Date().toISOString() }];
        const { error: cErr } = await supabase.from("tasks").update({ payload: { comments } }).eq("id", memberRows[0].id);
        if (cErr) throw cErr;
      }
    }
    console.log(`Plano "${plan.title}": criado com ${plan.members.length} atividades reais.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
