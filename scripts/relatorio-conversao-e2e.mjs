// Harness CLI do fluxo de feedback / vendas (Automação 1 relatorio_trafego_semanal
// + Automação 2 relatorio_vendas). Testa ponta a ponta sem UI.
//
// Uso (lê .env.local para NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//   node scripts/relatorio-conversao-e2e.mjs seed [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs inspect [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs reset-lastrun [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs comment "<texto>" <taskId>   (occ OU card1)
//   node scripts/relatorio-conversao-e2e.mjs overdue [--client cris-car-care] [dias]
//   node scripts/relatorio-conversao-e2e.mjs teardown [--client cris-car-care]
//
// Entre seed e inspect, dispare um tique da cron:
//   RUN_AUTOMATIONS=1 AI_CLI=1 AI_CLI_BIN=<claude> AI_MODEL=sonnet npx vitest run lib/automations/e2e.manual.test.ts
//
// Sequência de um caso:
//   node scripts/relatorio-conversao-e2e.mjs seed
//   <tique 1>   → Autom.1 cria a ocorrência + card1 (PDF Meta) → card1 revisão; Autom.2 comenta o pedido no pai
//   node scripts/relatorio-conversao-e2e.mjs comment "Semana boa! 3 vendas, uma R$1400 pela #2, +45 seguidores." <occId>
//   node scripts/relatorio-conversao-e2e.mjs reset-lastrun
//   <tique 2>   → Autom.2 cria card2, grava task_metrics, gera o PDF de vendas, card2+pai → revisão
//   node scripts/relatorio-conversao-e2e.mjs inspect
//   node scripts/relatorio-conversao-e2e.mjs teardown

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch { /* opcional */ }
}
loadEnvLocal();

// ---- ids determinísticos (cópia de lib/derivedTaskId.ts / recurrence / flows/ids)
function derivedTaskId(parentId, identity) {
  const d = createHash("sha256").update(`${parentId}:${identity}`).digest("hex").slice(0, 32).split("");
  d[12] = "5";
  d[16] = ((parseInt(d[16], 16) & 3) | 8).toString(16);
  return `${d.slice(0, 8).join("")}-${d.slice(8, 12).join("")}-${d.slice(12, 16).join("")}-${d.slice(16, 20).join("")}-${d.slice(20).join("")}`;
}
const recurringExecutionId = (parentId, cycle) => derivedTaskId(parentId, `cycle:${cycle}`);
const flowStepTaskId = (deliveryId, stepKey) => derivedTaskId(deliveryId, `flow-step:${stepKey}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}
const db = createClient(url, key);

const argv = process.argv.slice(2);
const cmd = argv[0];
const clientFlag = (() => {
  const i = argv.indexOf("--client");
  return i >= 0 ? argv[i + 1] : "cris-car-care";
})();
const iso = (d) => d.toISOString().slice(0, 10);
const MOLD_TITLE = "Relatório de anúncios — e2e";

async function resolveClient() {
  const { data, error } = await db.from("clients").select("id,slug,name").eq("slug", clientFlag).limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new Error(`cliente ${clientFlag} não encontrado`);
  return data[0];
}
async function adminProfileId() {
  const { data } = await db.from("profiles").select("id").eq("role", "admin").limit(1);
  return data?.[0]?.id ?? null;
}
async function findMold(clientId) {
  const { data } = await db.from("tasks").select("*")
    .eq("client_id", clientId).eq("title", MOLD_TITLE)
    .not("recurrence_cadence", "is", null).limit(1);
  return data?.[0] ?? null;
}

async function seed() {
  const client = await resolveClient();
  const createdBy = await adminProfileId();
  const today = iso(new Date());
  const weekday = new Date().getDay();

  let mold = await findMold(client.id);
  if (!mold) {
    // M1: tarefa recorrente COMUM (sem flow_parent). A ocorrência é que vira o
    // pai do fluxo, criada pela Automação 1 no tique.
    const { data, error } = await db.from("tasks").insert({
      client_id: client.id,
      kind: "operacional",
      subtype: null,
      title: MOLD_TITLE,
      status: "backlog",
      priority: "media",
      recurrence_cadence: "semanal",
      recurrence_weekdays: [weekday],
      due_date: today, start_date: today, end_date: today,
      payload: { recurrence_group: true, recurrence_cycle: 0, recurrence_revision: 1 },
    }).select("*").limit(1);
    if (error) throw error;
    mold = data[0];
  }

  for (const [automationKey, extra] of [
    ["relatorio_trafego_semanal", {}],
    ["relatorio_vendas", { collect_metric_keys: ["vendas", "agendamentos", "seguidores", "receita"] }],
  ]) {
    const { data: cfg } = await db.from("automation_configs").select("id")
      .eq("target_task_id", mold.id).eq("automation_key", automationKey).limit(1);
    if (!cfg?.[0]) {
      const { error } = await db.from("automation_configs").insert({
        automation_key: automationKey, target_task_id: mold.id, performance_template_id: null, active: true, created_by: createdBy, ...extra,
      });
      if (error) throw error;
    }
  }

  const occId = recurringExecutionId(mold.id, 0);
  console.log(JSON.stringify({
    client: client.slug, moldId: mold.id, occId,
    card1_trafego: flowStepTaskId(occId, "trafego"),
    card2_feedback: flowStepTaskId(occId, "feedback"),
  }, null, 2));
}

async function inspect() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("sem molde — rode `seed` primeiro");
  const occId = recurringExecutionId(mold.id, 0);
  const card1 = flowStepTaskId(occId, "trafego");
  const card2 = flowStepTaskId(occId, "feedback");

  const { data: tasks } = await db.from("tasks").select("id,kind,subtype,status,completed_at,due_date,payload")
    .in("id", [mold.id, occId, card1, card2]);
  const { data: links } = await db.from("task_links").select("parent_id,child_id,slot,position").eq("parent_id", occId);
  const { data: metrics } = await db.from("task_metrics").select("task_id,metrics,source,updated_at").eq("client_id", client.id);
  const { data: docs } = await db.from("documents").select("name,doc_type,doc_date,task_id,file_url").eq("client_id", client.id).order("created_at", { ascending: false }).limit(8);

  const label = (id) => id === mold.id ? "MOLDE" : id === occId ? "OCORRÊNCIA (pai)" : id === card1 ? "card1 trafego" : id === card2 ? "card2 feedback" : id;
  console.log("=== MOLDE ===");
  console.log({ id: mold.id, status: mold.status, due_date: mold.due_date, cycle: mold.payload?.recurrence_cycle });
  console.log("=== TASKS ===");
  for (const t of tasks ?? []) console.log({
    what: label(t.id), status: t.status, completed_at: t.completed_at,
    comments: (t.payload?.comments ?? []).map((c) => `${c.author}: ${c.text}`),
    metricas: t.payload?.metricas, linhas: t.payload?.linhas?.length,
    markers: { trafego: t.payload?.trafego_report_at, prompt: t.payload?.feedback_prompt_at, src: t.payload?.feedback_source_at, sales: t.payload?.sales_report_generated_at },
  });
  console.log("=== task_links da ocorrência ===");
  console.log(links);
  console.log("=== task_metrics ===");
  console.log(metrics);
  console.log("=== documents (recentes) ===");
  console.log((docs ?? []).map((d) => ({ name: d.name, doc_type: d.doc_type, doc_date: d.doc_date, task_id: d.task_id })));
}

async function resetLastrun() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("sem molde");
  const { error } = await db.from("automation_configs").update({ last_run_date: null }).eq("target_task_id", mold.id);
  if (error) throw error;
  console.log("last_run_date zerado nas configs do molde");
}

async function comment() {
  const text = argv[1];
  const taskId = argv[2];
  if (!text || !taskId) return console.error('uso: comment "<texto>" <taskId>');
  const { data } = await db.from("tasks").select("payload").eq("id", taskId).limit(1);
  if (!data?.[0]) return console.error("card não encontrado");
  const payload = data[0].payload ?? {};
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  comments.push({ author: "Gestor North", text, at: new Date().toISOString() });
  const { error } = await db.from("tasks").update({ payload: { ...payload, comments: comments.slice(-200) } }).eq("id", taskId);
  if (error) throw error;
  console.log("comentário adicionado");
}

async function overdue() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("sem molde");
  const dias = Number(argv.find((a) => /^\d+$/.test(a))) || 6;
  const past = iso(new Date(Date.now() - dias * 86400000));
  const occId = recurringExecutionId(mold.id, 0);
  const card2 = flowStepTaskId(occId, "feedback");
  await db.from("tasks").update({ due_date: past }).eq("id", occId);
  await db.from("tasks").update({ due_date: past }).eq("id", card2);
  console.log(`ocorrência (e card2 se existir) recuada para ${past}`);
}

async function teardown() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("nada para remover");
  await db.from("automation_configs").delete().eq("target_task_id", mold.id);
  const stepIds = [];
  for (let cycle = 0; cycle < 6; cycle++) {
    const occId = recurringExecutionId(mold.id, cycle);
    stepIds.push(flowStepTaskId(occId, "trafego"), flowStepTaskId(occId, "feedback"));
    await db.from("documents").delete().eq("task_id", occId);
    await db.from("tasks").delete().eq("id", occId);
  }
  await db.from("documents").delete().in("task_id", stepIds);
  await db.from("tasks").delete().in("id", stepIds);
  await db.from("tasks").delete().or(`plan_id.eq.${mold.id}`);
  await db.from("tasks").delete().eq("id", mold.id);
  console.log("removidos molde, ocorrências, etapas, documents e configs (storage: rode o remove manual)");
}

const map = { seed, inspect, "reset-lastrun": resetLastrun, comment, overdue, teardown };
if (!map[cmd]) {
  console.error("comandos: seed | inspect | reset-lastrun | comment | overdue | teardown");
  process.exit(1);
}
map[cmd]().catch((e) => { console.error(e); process.exit(1); });
