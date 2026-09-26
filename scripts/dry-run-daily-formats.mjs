// Execute the versioned migration in a transaction and always roll it back.
import pg from "pg";
import { readFileSync } from "node:fs";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const sql = readFileSync("supabase/migrations/20260926020000_daily_piece_format_workflows.sql", "utf8")
  .replace(/^BEGIN;\s*$/m, "")
  .replace(/^COMMIT;\s*$/m, "");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, statement_timeout: 120_000,
  application_name: "north-daily-formats-rollback-dry-run" });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(sql);
  const { rows } = await db.query(`select t.key, v.version, count(s.id)::int as steps
    from public.task_types t join public.workflow_versions v on v.delivery_type_id = t.id and v.status = 'published'
    join public.workflow_version_steps s on s.workflow_version_id = v.id
    where t.key like 'entrega_%' group by t.key, v.version order by t.key`);
  if (rows.length !== 5 || rows.some((row) => row.steps !== 4)) {
    throw new Error("Os cinco formatos não foram criados com quatro etapas.");
  }
  const format = await db.query("select id from public.task_types where key='entrega_reels'");
  const { rows: editorRows } = await db.query(`select jsonb_agg(jsonb_build_object(
    'key', step_key, 'label', label, 'progress_weight', progress_weight,
    'lead_days', lead_days, 'default_assignee', default_assignee,
    'client_visible', client_visible) order by order_index) as steps
    from public.workflow_version_steps where workflow_version_id =
    (select id from public.workflow_versions where delivery_type_id=$1 and status='published')`, [format.rows[0].id]);
  await db.query("select public.publish_delivery_workflow($1,$2::jsonb)",
    [format.rows[0].id, JSON.stringify(editorRows[0].steps)]);
  const edited = await db.query("select version from public.workflow_versions where delivery_type_id=$1 and status='published'",
    [format.rows[0].id]);
  if (edited.rows[0]?.version !== 2) throw new Error("A edição não publicou a versão 2.");

  const fixture = await db.query(`insert into public.tasks (
    client_id, task_type_id, title, status, priority, assignee,
    reviewer_id, approver_id, requires_review, requires_approval,
    due_date, start_date, client_visible, payload, position,
    recurrence_cadence, recurrence_weekdays, recurrence_day_of_month
  ) select client_id, task_type_id, 'Teste transacional formatos diária', 'backlog',
    priority, assignee, reviewer_id, approver_id, requires_review,
    requires_approval, date '2026-10-01', date '2026-10-01', false,
    '{"recurrence_group":true,"recurrence_cycle":0,"recurrence_revision":0}'::jsonb,
    0, 'semanal', '{4}'::smallint[], null
    from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
    returning id,client_id`);
  const mold = fixture.rows[0];
  if (!mold) throw new Error("Plano BAITA de referência ausente.");
  const base = await db.query("select id from public.task_types where key='criativo'");
  const other = await db.query("select id from public.task_types where key='entrega_story'");
  const effective = { clientId: mold.client_id, deliveryTypeId: base.rows[0].id,
    pieces: [
      { key: crypto.randomUUID(), name: "Peça A", format: "Reels", deliveryTypeId: format.rows[0].id, offsetDays: 2 },
      { key: crypto.randomUUID(), name: "Peça B", format: "Story", deliveryTypeId: other.rows[0].id, offsetDays: 4 },
    ] };
  const config = await db.query(`insert into public.automation_configs
    (automation_key,target_task_id,active,daily_config)
    values ('diaria_recorrente',$1,true,$2::jsonb) returning id`, [mold.id, JSON.stringify(effective)]);
  const first = await db.query("select public.materialize_recurring_daily($1,$2,null) as id",
    [config.rows[0].id, "2026-10-01"]);
  const repeated = await db.query("select public.materialize_recurring_daily($1,$2,null) as id",
    [config.rows[0].id, "2026-10-01"]);
  const executionId = first.rows[0].id;
  const counts = await db.query(`select
    (select count(*)::int from public.tasks where payload->>'daily_execution_id'=$1::text
      and payload ? 'daily_piece_key') as pieces,
    (select count(*)::int from public.task_links where parent_id=$1::uuid and relation_kind='structural_member') as members,
    (select count(*)::int from public.task_links where child_id=(select (payload->>'daily_script_task_id')::uuid
      from public.tasks where id=$1::uuid) and relation_kind='workflow_step') as script_links,
    (select array_agg(kind order by kind) from public.tasks where payload->>'daily_execution_id'=$1::text
      and payload ? 'daily_piece_key') as kinds`, [executionId]);
  const result = { dryRun: "ok", formats: rows, editorVersion: edited.rows[0].version,
    sameExecution: executionId === repeated.rows[0].id, ...counts.rows[0], rolledBack: true };
  console.log(JSON.stringify(result));
  if (!result.sameExecution || result.pieces !== 2 || result.members !== 4 || result.script_links !== 2 ||
      result.kinds?.join(",") !== "entrega_reels,entrega_story") {
    throw new Error("Cardinalidade ou tipos das peças inválidos.");
  }
} finally {
  await db.query("ROLLBACK").catch(() => undefined);
  await db.end().catch(() => undefined);
}
