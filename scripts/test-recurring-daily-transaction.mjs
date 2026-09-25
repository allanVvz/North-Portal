// Controlled production-only transaction: fixture and DDL are always rolled back.
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const sql = readFileSync("supabase/migrations/20260925220658_recurring_daily_materials.sql", "utf8")
  .replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-rollback-test" });
await db.connect();
try {
  await db.query("begin");
  const installed = await db.query(`select count(*)::int as present from information_schema.columns
    where table_schema='public' and table_name='automation_configs' and column_name='daily_config'`);
  if (!installed.rows[0].present) await db.query(sql);
  const fixture = await db.query(`
    insert into public.tasks (
      client_id, task_type_id, title, status, priority, assignee,
      reviewer_id, approver_id, requires_review, requires_approval,
      due_date, start_date, client_visible, payload, position,
      recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
    ) select client_id, task_type_id, 'Teste transacional diária', 'backlog',
      priority, assignee, reviewer_id, approver_id, requires_review,
      requires_approval, date '2026-10-01', date '2026-10-01', false,
      '{"recurrence_group":true,"recurrence_cycle":0,"recurrence_revision":0}'::jsonb,
      0, 'semanal', '{4}'::smallint[], null
    from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
    returning id,client_id;
  `);
  const mold = fixture.rows[0];
  if (!mold) throw new Error("Plano BAITA de referência ausente.");
  const workflow = await db.query(`select delivery_type_id from public.workflow_versions
    where status='published' and delivery_type_id=(select id from public.task_types where key='criativo')
    order by version desc limit 1`);
  if (!workflow.rows[0]) throw new Error("Workflow Criativo ausente.");
  const effective = { clientId: mold.client_id, deliveryTypeId: workflow.rows[0].delivery_type_id,
    pieces: [
      { key: crypto.randomUUID(), name: "Peça teste A", format: "Reels", offsetDays: 2 },
      { key: crypto.randomUUID(), name: "Peça teste B", format: "Story", offsetDays: 4 },
    ] };
  const inserted = await db.query(`insert into public.automation_configs
    (automation_key,target_task_id,active,daily_config)
    values ('diaria_recorrente',$1,true,$2::jsonb) returning id`, [mold.id, JSON.stringify(effective)]);
  const configId = inserted.rows[0].id;
  await db.query("savepoint daily_failure");
  let failedAsExpected = false;
  try {
    const invalid = { ...effective, pieces: [{ ...effective.pieces[0], offsetDays: "invalid" }] };
    await db.query("select public.materialize_recurring_daily($1, $2, $3::jsonb)",
      [configId, "2026-10-08", JSON.stringify(invalid)]);
  } catch { failedAsExpected = true; }
  await db.query("rollback to savepoint daily_failure");
  if (!failedAsExpected) throw new Error("A falha controlada não foi detectada.");
  const first = await db.query("select public.materialize_recurring_daily($1, $2, null) as id", [configId, "2026-10-01"]);
  const repeated = await db.query("select public.materialize_recurring_daily($1, $2, $3::jsonb) as id",
    [configId, "2026-10-01", JSON.stringify({ ...effective, pieces: [effective.pieces[0]] })]);
  const executionId = first.rows[0].id;
  const counts = await db.query(`select
    (select count(*)::int from public.task_links where parent_id=$1 and relation_kind='structural_member') as members,
    (select count(*)::int from public.tasks where plan_id=$2 and payload->>'occurrence_date'='2026-10-01') as executions,
    (select count(*)::int from public.tasks where payload->>'daily_execution_id'=$1::text and kind='criativo') as creatives,
    (select count(*)::int from public.task_links where child_id=(select (payload->>'daily_script_task_id')::uuid from public.tasks where id=$1) and relation_kind='workflow_step') as script_links
  `, [executionId, mold.id]);
  const next = await db.query("select public.materialize_recurring_daily($1, $2, $3::jsonb) as id",
    [configId, "2026-10-08", JSON.stringify({ ...effective, pieces: [effective.pieces[0]] })]);
  const nextCount = await db.query("select count(*)::int as creatives from public.tasks where payload->>'daily_execution_id'=$1 and kind='criativo'",
    [next.rows[0].id]);
  const result = { sameExecution: executionId === repeated.rows[0].id,
    failedAsExpected, nextCycleCreatives: nextCount.rows[0].creatives, ...counts.rows[0], rolledBack: true };
  console.log(JSON.stringify(result));
  if (!result.sameExecution || result.executions !== 1 || result.creatives !== 2 ||
      result.script_links !== 2 || result.nextCycleCreatives !== 1) {
    throw new Error("Cardinalidade da diária inválida.");
  }
} finally {
  await db.query("rollback").catch(() => undefined);
  await db.end();
}
