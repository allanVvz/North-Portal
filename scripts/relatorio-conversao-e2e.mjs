// Harness CLI do fluxo de conversão / vendas (relatorio_conversao +
// relatorio_trafego_semanal + relatorio_vendas). Testa ponta a ponta sem UI.
//
// Uso (lê .env.local para NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//   node scripts/relatorio-conversao-e2e.mjs seed [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs inspect [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs reset-lastrun [--client cris-car-care]
//   node scripts/relatorio-conversao-e2e.mjs comment "<texto>" <stepId>
//   node scripts/relatorio-conversao-e2e.mjs teardown [--client cris-car-care]
//
// Entre seed e inspect, dispare um tique da cron — pelo endpoint real:
//   Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/admin/automations/run -Headers @{ "x-cron-secret" = "<CRON_SECRET>" }
// ...ou direto (não precisa de next dev):
//   RUN_AUTOMATIONS=1 npx vitest run lib/automations/e2e.manual.test.ts
//
// Sequência completa:
//   node scripts/relatorio-conversao-e2e.mjs seed
//   <tique 1>            → etapa relatorio_trafego 'aprovado' + PDF; etapa agendamentos criada
//   node scripts/relatorio-conversao-e2e.mjs comment "fechamos 5 agendamentos" <agendamentosStepId>
//   node scripts/relatorio-conversao-e2e.mjs reset-lastrun
//   <tique 2>            → task_metrics gravado; etapa 'aprovado'; PDF de vendas; ocorrência encerrada
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
const MOLD_TITLE = "Relatório de conversão — e2e";

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
    .eq("client_id", clientId).eq("kind", "relatorio_conversao").eq("title", MOLD_TITLE)
    .contains("payload", { recurrence_group: true }).limit(1);
  return data?.[0] ?? null;
}

async function seed() {
  const client = await resolveClient();
  const createdBy = await adminProfileId();
  const today = iso(new Date());
  const weekday = new Date().getDay();

  let mold = await findMold(client.id);
  if (!mold) {
    const { data, error } = await db.from("tasks").insert({
      client_id: client.id,
      kind: "relatorio_conversao",
      subtype: null,
      title: MOLD_TITLE,
      status: "em_producao",
      priority: "media",
      recurrence_cadence: "semanal",
      recurrence_weekdays: [weekday],
      due_date: today, start_date: today, end_date: today,
      reviewer_id: null, approver_id: null,
      payload: { recurrence_group: true, recurrence_cycle: 0, recurrence_revision: 1, flow_parent: true, flow_total_weight: 2, flow_step_count: 2 },
    }).select("*").limit(1);
    if (error) throw error;
    mold = data[0];
  }

  const occId = recurringExecutionId(mold.id, 0);
  const { data: occExisting } = await db.from("tasks").select("id").eq("id", occId).limit(1);
  if (!occExisting?.[0]) {
    const { error } = await db.from("tasks").insert({
      id: occId,
      client_id: client.id,
      kind: "relatorio_conversao",
      subtype: null,
      title: MOLD_TITLE,
      status: "backlog",
      priority: "media",
      plan_id: mold.id,
      due_date: today, start_date: today,
      payload: { flow_parent: true, flow_total_weight: 2, flow_step_count: 2, recurrence_parent_id: mold.id, occurrence_date: today, recurrence_cycle: 0 },
    });
    if (error) throw error;
  }

  const stepId = flowStepTaskId(occId, "relatorio_trafego");
  const { data: stepExisting } = await db.from("tasks").select("id").eq("id", stepId).limit(1);
  if (!stepExisting?.[0]) {
    const { error } = await db.from("tasks").insert({
      id: stepId,
      client_id: client.id,
      kind: "relatorio_conversao",
      subtype: "relatorio_trafego",
      title: `${MOLD_TITLE} — Relatório de tráfego`,
      status: "backlog",
      priority: "media",
      assignee: "North ai",
      due_date: today, start_date: today,
      progress_weight: 1,
      position: 10,
      payload: {},
    });
    if (error) throw error;
    const { error: linkErr } = await db.from("task_links").insert({ parent_id: occId, child_id: stepId, slot: "relatorio_trafego", position: 10 });
    if (linkErr && linkErr.code !== "23505") throw linkErr;
  }

  for (const automationKey of ["relatorio_trafego_semanal", "relatorio_vendas"]) {
    const { data: cfg } = await db.from("automation_configs").select("id")
      .eq("target_task_id", mold.id).eq("automation_key", automationKey).limit(1);
    if (!cfg?.[0]) {
      const { error } = await db.from("automation_configs").insert({
        automation_key: automationKey, target_task_id: mold.id, performance_template_id: null, active: true, created_by: createdBy,
      });
      if (error) throw error;
    }
  }

  console.log(JSON.stringify({ client: client.slug, moldId: mold.id, occId, trafegoStepId: stepId, agendamentosStepId: flowStepTaskId(occId, "agendamentos") }, null, 2));
}

async function inspect() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("sem molde — rode `seed` primeiro");
  const occId = recurringExecutionId(mold.id, 0);

  const { data: tasks } = await db.from("tasks").select("id,kind,subtype,status,completed_at,due_date,payload,plan_id")
    .or(`id.eq.${mold.id},id.eq.${occId},plan_id.eq.${mold.id},plan_id.eq.${occId}`);
  const { data: links } = await db.from("task_links").select("parent_id,child_id,slot,position").eq("parent_id", occId);
  const { data: metrics } = await db.from("task_metrics").select("task_id,metrics,source,updated_at").eq("client_id", client.id);
  const { data: docs } = await db.from("documents").select("name,doc_type,doc_date,task_id,file_url").eq("client_id", client.id).order("created_at", { ascending: false }).limit(8);

  console.log("=== MOLDE ===");
  console.log({ id: mold.id, status: mold.status, due_date: mold.due_date, cycle: mold.payload?.recurrence_cycle });
  console.log("=== TASKS (molde/ocorrência/etapas) ===");
  for (const t of tasks ?? []) console.log({ id: t.id, kind: t.kind, subtype: t.subtype, status: t.status, completed_at: t.completed_at, comments: (t.payload?.comments ?? []).map((c) => `${c.author}: ${c.text}`), conversoes: t.payload?.conversoes?.length, markers: { src: t.payload?.conversao_source_at, sales: t.payload?.sales_report_generated_at } });
  console.log("=== task_links da ocorrência ===");
  console.log(links);
  console.log("=== task_metrics ===");
  console.log(metrics);
  console.log("=== documents (recentes) ===");
  console.log((docs ?? []).map((d) => ({ name: d.name, doc_type: d.doc_type, doc_date: d.doc_date, task_id: d.task_id, url: d.file_url })));
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
  const stepId = argv[2];
  if (!text || !stepId) return console.error('uso: comment "<texto>" <stepId>');
  const { data } = await db.from("tasks").select("payload").eq("id", stepId).limit(1);
  if (!data?.[0]) return console.error("etapa não encontrada");
  const payload = data[0].payload ?? {};
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  comments.push({ author: "Luiza (CRIS CAR CARE)", text, at: new Date().toISOString() });
  const { error } = await db.from("tasks").update({ payload: { ...payload, comments: comments.slice(-200) } }).eq("id", stepId);
  if (error) throw error;
  console.log("comentário adicionado");
}

async function teardown() {
  const client = await resolveClient();
  const mold = await findMold(client.id);
  if (!mold) return console.log("nada para remover");
  await db.from("automation_configs").delete().eq("target_task_id", mold.id);
  // As etapas são ligadas por task_links (plan_id null), então não caem por
  // plan_id nem por cascade da ocorrência — apago por id determinístico.
  const stepIds = [];
  for (let cycle = 0; cycle < 6; cycle++) {
    const occId = recurringExecutionId(mold.id, cycle);
    stepIds.push(flowStepTaskId(occId, "relatorio_trafego"), flowStepTaskId(occId, "agendamentos"));
    await db.from("documents").delete().eq("task_id", occId);
    await db.from("tasks").delete().eq("id", occId);
  }
  await db.from("documents").delete().in("task_id", stepIds);
  await db.from("tasks").delete().in("id", stepIds);
  await db.from("tasks").delete().or(`plan_id.eq.${mold.id}`);
  await db.from("tasks").delete().eq("id", mold.id);
  console.log("removidos molde, ocorrências, etapas, documents e configs (storage: rode o remove manual)");
}

const map = { seed, inspect, "reset-lastrun": resetLastrun, comment, teardown };
if (!map[cmd]) {
  console.error("comandos: seed | inspect | reset-lastrun | comment | teardown");
  process.exit(1);
}
map[cmd]().catch((e) => { console.error(e); process.exit(1); });
