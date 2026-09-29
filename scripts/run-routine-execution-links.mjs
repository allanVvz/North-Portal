import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const pg = createRequire("/tmp/north-db/package.json")("pg");
const version = "20260929062000";
const name = "routine_execution_links";
const migration = readFileSync(`supabase/migrations/${version}_${name}.sql`, "utf8");
const postflight = readFileSync(`supabase/postflight/${version}_${name}.sql`, "utf8");
const mode = process.argv[2];
if (!["--preflight", "--dry-run", "--apply", "--postflight", "--record-ledger"].includes(mode)) throw new Error("Modo inválido.");
const inner = migration.replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
if (inner === migration) throw new Error("SQL precisa ser transacional.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, statement_timeout: 120_000, application_name: "north-routine-execution-links" });
const target = {
  template: "71e87469-990b-416e-9d0e-a6f57e781343",
  cycle: "e5f32ccc-154a-4d11-b5dc-1098bec58fcc",
  plan: "7e1a162d-ff0f-414e-ad50-bea8b472fbcd",
};
async function preflight() {
  const ledger = (await db.query("select version,name from supabase_migrations.schema_migrations order by version desc limit 3")).rows;
  const schema = (await db.query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('tasks','task_links','routine_execution_links') and column_name in ('id','parent_id','child_id','plan_id','payload','client_id','kind','due_date') order by table_name,column_name")).rows;
  const cards = (await db.query("select id,client_id,kind,plan_id,due_date,payload->>'occurrence_date' as occurrence_date from public.tasks where id=any($1::uuid[]) order by id", [Object.values(target)])).rows;
  const oldLinks = (await db.query("select parent_id,child_id,relation_kind from public.task_links where parent_id=$1 and child_id=$2", [target.cycle, target.plan])).rows;
  const cycles = (await db.query("select id,payload->>'occurrence_date' as date from public.tasks where plan_id=$1 and payload->>'recurrence_parent_id'=$1::text order by due_date", [target.template])).rows;
  console.log(JSON.stringify({ mode: "preflight", ledger, schema, cards, oldLinks, cycles }));
  if (ledger[0]?.version !== "20260929042154" || cards.length !== 3 || oldLinks.length > 1 ||
      cards.find((row) => row.id === target.plan)?.plan_id !== null) throw new Error("Preflight divergiu.");
  return cycles;
}
async function verify() {
  await db.query(postflight);
  const { rows } = await db.query("select template_id,cycle_id,occurrence_date,task_id from public.routine_execution_links where task_id=$1", [target.plan]);
  console.log(JSON.stringify({ mode: "postflight", links: rows }));
}
await db.connect();
try {
  if (mode === "--preflight") await preflight();
  if (mode === "--dry-run") {
    const cycles = await preflight();
    await db.query("begin");
    try {
      await db.query(inner);
      await verify();
      const other = (await db.query("select id from public.tasks where client_id <> $1 and kind <> 'plano_acao' and recurrence_cadence is null and id <> $2 limit 1", ["d7cdbac3-775d-457f-b25a-dbf899687853", target.plan])).rows[0];
      if (!other) throw new Error("Sem tarefa de outro tipo para prova.");
      await db.query("insert into public.routine_execution_links(template_id,cycle_id,occurrence_date,task_id) values($1,$2,'2026-09-16',$3)", [target.template, target.cycle, other.id]);
      const second = cycles.find((cycle) => cycle.id !== target.cycle && cycle.date);
      if (second) await db.query("insert into public.routine_execution_links(template_id,cycle_id,occurrence_date,task_id) values($1,$2,$3,$4)", [target.template, second.id, second.date, target.plan]);
      const count = Number((await db.query("select count(*)::int as n from public.routine_execution_links where cycle_id=$1", [target.cycle])).rows[0].n);
      if (count < 2) throw new Error("Múltiplas execuções na reunião falharam.");
      await db.query("delete from public.routine_execution_links where cycle_id=$1 and task_id=$2", [target.cycle, other.id]);
      const remaining = Number((await db.query("select count(*)::int as n from public.routine_execution_links where cycle_id=$1", [target.cycle])).rows[0].n);
      if (remaining !== count - 1) throw new Error("Desvinculação falhou.");
      console.log(JSON.stringify({ mode: "dry-run", multipleSameDate: true, sameTaskAnotherDate: Boolean(second), unlink: true }));
    } finally { await db.query("rollback"); }
  }
  if (mode === "--apply") { await preflight(); await db.query(migration); await verify(); }
  if (mode === "--postflight") await verify();
  if (mode === "--record-ledger") {
    await verify();
    await db.query("begin");
    try {
      const latest = (await db.query("select version from supabase_migrations.schema_migrations order by version desc limit 1 for update")).rows[0]?.version;
      if (latest !== "20260929042154") throw new Error(`Ledger mudou: ${latest}`);
      await db.query("insert into supabase_migrations.schema_migrations(version,name,created_by) values($1,$2,$3)", [version, name, "codex"]);
      await db.query("commit");
      console.log(JSON.stringify({ mode: "ledger", recorded: version }));
    } catch (error) { await db.query("rollback"); throw error; }
  }
} finally { await db.end(); }
