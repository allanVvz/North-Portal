// Auditoria SOMENTE LEITURA da operação de setembro/2026 da Baita Conveniencia.
//
// Existe porque metade dos cards do mês nasceu solta — sem elo com o Plano de Ação
// nem com uma Entrega —, e o sintoma que apareceu para o usuário foi a caixa
// "Faz parte de" não existir ao abrir o card por uma notificação. A caixa está
// certa: ela resolve o pai a partir de `liveTask.parents`, que o servidor popula em
// toda rota. O que falta é o elo.
//
// Este script não escreve nada. É o relatório que precisa ser revisado antes das
// fases que escrevem (criar Entregas, ligar ao plano, tratar duplicatas), porque
// duas coisas dependem de decisão humana:
//
//   1. Qual publicação veio de qual diária de gravação. As publicações soltas vencem
//      entre 01 e 13/09, ANTES da "Gravação 17/09" — a data não permite inferir a
//      origem, e adivinhar produziria uma Entrega mentindo sobre a própria história.
//   2. Quais duplicatas podem ser vinculadas com segurança. Um par "mesmo título,
//      mesma data" costuma ser a ocorrência que a recorrência gerou (id derivado,
//      v5) mais uma cópia criada à mão (id aleatório, v4). Qual delas carrega
//      comentário, anexo ou conclusão decide o que fazer com cada uma.
//
// Uso: node scripts/baita-setembro-auditoria.mjs [--slug=outro-cliente] [--mes=2026-09]

import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SLUG = arg("slug", "baita-conveniencia");
const MES = arg("mes", "2026-09");
if (!/^\d{4}-\d{2}$/.test(MES)) {
  console.error("--mes deve ser AAAA-MM.");
  process.exit(2);
}
const INICIO = `${MES}-01`;
const FIM = new Date(Date.UTC(Number(MES.slice(0, 4)), Number(MES.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** As etapas do workflow "Criativo v1", na ordem. Um card solto que já carrega um
 *  destes subtypes nasceu com a etapa certa e sem Entrega para pendurar. */
const ETAPAS_CRIATIVO = ["roteiro", "captacao", "edicao", "publicacao"];

/** Um id derivado (`derivedTaskId`) tem o nibble de versão 5; um criado pela
 *  interface é v4 aleatório. É o que distingue "a recorrência gerou" de "alguém
 *  criou à mão" num par de mesmo título e data. */
const derivado = (id) => id[14] === "5";

// O driver devolve `date` como Date; `String(date)` daria "Thu Sep 10 ...".
const dia = (v) => {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};
const linha = (n = 78) => console.log("─".repeat(n));
const titulo = (t) => { console.log(`\n${t}`); linha(); };

const db = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const { rows: cliente } = await db.query("select id, name from public.clients where slug = $1", [SLUG]);
  if (!cliente.length) {
    console.error(`Cliente "${SLUG}" não encontrado.`);
    process.exit(1);
  }
  const CLIENTE = cliente[0].id;
  console.log(`\n${cliente[0].name} · ${MES} (${INICIO} a ${FIM})`);

  // ---- 1. o que está solto, classificado -----------------------------------
  const { rows: soltas } = await db.query(`
    select t.id, t.title, t.kind, t.subtype, t.status, t.due_date, t.assignee,
           t.workflow_version_id is not null as tem_workflow,
           t.recurrence_cadence,
           jsonb_array_length(coalesce(t.payload->'comments', '[]'::jsonb)) as comentarios,
           t.completed_at is not null as concluida
    from public.tasks t
    where t.client_id = $1::uuid
      and t.due_date between $2::date and $3::date
      and t.kind <> 'plano_acao'
      and not exists (select 1 from public.task_links l where l.child_id = t.id)
    order by t.due_date, t.title`, [CLIENTE, INICIO, FIM]);

  const classificar = (t) => {
    if (t.kind === "automacao" || t.assignee === "North Ai" || /relat[óo]rio/i.test(t.title)) return "automação de relatório";
    if (ETAPAS_CRIATIVO.includes(t.subtype ?? "")) return `conteúdo · etapa ${t.subtype}`;
    if (t.kind === "criativo") return "criativo sem workflow";
    if (t.recurrence_cadence || /di[áa]ria|reuni[ãa]o|cobran[çc]a|mensalidade/i.test(t.title)) return "rotina administrativa";
    return "conteúdo sem etapa declarada";
  };

  titulo(`1. CARDS SOLTOS — ${soltas.length}`);
  const porClasse = new Map();
  for (const t of soltas) {
    const classe = classificar(t);
    porClasse.set(classe, [...(porClasse.get(classe) ?? []), t]);
  }
  for (const [classe, itens] of [...porClasse].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${classe} — ${itens.length}`);
    for (const t of itens) {
      const marcas = [t.concluida ? "concluída" : null, t.comentarios > 0 ? `${t.comentarios} coment.` : null]
        .filter(Boolean).join(", ");
      console.log(`    ${dia(t.due_date)}  ${t.title}${marcas ? `  [${marcas}]` : ""}`);
      console.log(`              ${t.id}  kind=${t.kind} subtype=${t.subtype ?? "—"} status=${t.status}`);
    }
  }

  // ---- 2. proposta de agrupamento publicação ↔ diária ----------------------
  // A única pista textual é a data no título ("17/09", "19/09"). Onde ela não
  // existir, a Entrega nasce só com a etapa de publicação — marcado abaixo.
  titulo("2. PROPOSTA DE AGRUPAMENTO — precisa da sua revisão");
  const dataNoTitulo = (s) => s.match(/(\d{1,2})\/(\d{1,2})/)?.[0] ?? null;
  const compartilhaveis = soltas.filter((t) => ["roteiro", "captacao"].includes(t.subtype ?? ""));
  const publicacoes = soltas.filter((t) => t.subtype === "publicacao" || (t.kind === "criativo" && !t.tem_workflow));
  const edicoes = soltas.filter((t) => t.subtype === "edicao");

  if (!publicacoes.length) console.log("  (nenhuma publicação solta)");
  for (const p of publicacoes) {
    const marca = dataNoTitulo(p.title);
    const bloco = marca ? compartilhaveis.filter((c) => dataNoTitulo(c.title) === marca) : [];
    console.log(`\n  Entrega proposta: "${p.title}"  (publicação em ${dia(p.due_date)})`);
    if (bloco.length) {
      for (const c of bloco) console.log(`    ${String(c.subtype).padEnd(10)} ← ${c.title}   [COMPARTILHADO]`);
    } else {
      console.log(`    roteiro    ← SEM ROTEIRO/CAPTAÇÃO IDENTIFICADOS${marca ? ` (título marca ${marca}, sem par)` : " (título sem data)"}`);
    }
    console.log(`    publicacao ← ${p.title}`);
  }
  if (compartilhaveis.length) {
    console.log("\n  Cards compartilháveis disponíveis (roteiro/captação):");
    for (const c of compartilhaveis) console.log(`    ${dia(c.due_date)}  ${c.subtype}  ${c.title}`);
  }
  if (edicoes.length) {
    console.log("\n  Edições soltas — a qual publicação pertencem? (decisão sua)");
    for (const e of edicoes) console.log(`    ${dia(e.due_date)}  ${e.title}  ${e.id}`);
  }

  // ---- 3. duplicatas -------------------------------------------------------
  titulo("3. DUPLICATAS — mesmo título e mesma data");
  const { rows: dups } = await db.query(`
    select t.title, t.due_date,
           json_agg(json_build_object(
             'id', t.id, 'status', t.status,
             'comentarios', jsonb_array_length(coalesce(t.payload->'comments','[]'::jsonb)),
             'concluida', t.completed_at is not null,
             'anexos', (select count(*) from public.documents d where d.task_id = t.id),
             'recorrente', t.recurrence_cadence is not null,
             'pai_recorrencia', t.payload->>'recurrence_parent_id',
             'ligada', exists (select 1 from public.task_links l where l.child_id = t.id)
           ) order by t.id) as cards
    from public.tasks t
    where t.client_id = $1::uuid and t.kind <> 'plano_acao'
    group by t.title, t.due_date
    having count(*) > 1
    order by t.due_date nulls last, t.title`, [CLIENTE]);

  if (!dups.length) console.log("  (nenhuma)");
  for (const d of dups) {
    console.log(`\n  "${d.title}"  ${dia(d.due_date)}`);
    for (const c of d.cards) {
      const origem = derivado(c.id) ? "gerado pela recorrência" : "criado à mão";
      const historico = [
        c.concluida ? "concluída" : null,
        c.comentarios > 0 ? `${c.comentarios} coment.` : null,
        Number(c.anexos) > 0 ? `${c.anexos} anexo(s)` : null,
        c.ligada ? "já ligada" : null,
      ].filter(Boolean).join(", ") || "sem histórico";
      console.log(`    ${c.id}  ${origem.padEnd(24)} ${historico}`);
    }
  }

  // ---- 4. cards com o título do plano --------------------------------------
  titulo("4. CARDS COM O TÍTULO DO PLANO — um deles não deveria existir");
  const { rows: homonimos } = await db.query(`
    select t.id, t.kind, t.status, t.due_date,
           jsonb_array_length(coalesce(t.payload->'comments','[]'::jsonb)) as comentarios,
           (select count(*) from public.task_links l where l.parent_id = t.id) as filhos
    from public.tasks t
    where t.client_id = $1::uuid and upper(t.title) like '%PLANO DE CONTE%'
    order by t.kind`, [CLIENTE]);
  for (const h of homonimos) {
    console.log(`  ${h.id}  kind=${h.kind.padEnd(12)} status=${h.status.padEnd(12)} vence=${dia(h.due_date)}  filhos=${h.filhos}  coment.=${h.comentarios}`);
  }

  // ---- 5. o número que a verificação vai comparar --------------------------
  titulo("5. LINHA DE BASE");
  const { rows: base } = await db.query(`
    select count(*) filter (where not exists (select 1 from public.task_links l where l.child_id = t.id)) as soltas,
           count(*) filter (where exists (select 1 from public.task_links l where l.child_id = t.id)) as ligadas
    from public.tasks t
    where t.client_id = $1::uuid and t.due_date between $2::date and $3::date and t.kind <> 'plano_acao'`,
    [CLIENTE, INICIO, FIM]);
  console.log(`  soltas=${base[0].soltas}  ligadas=${base[0].ligadas}   (a meta é soltas=0)`);
  console.log("");
} finally {
  await db.end();
}
