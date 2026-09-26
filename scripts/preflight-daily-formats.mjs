// Read-only production preflight/postflight for 20260926020000.
import pg from "pg";
import { createHash } from "node:crypto";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-formats-preflight" });
await db.connect();
try {
  const queries = [
    `select now() as captured_at,
      (select count(*)::int from public.task_links where slot is not null and btrim(slot) = '') as invalid_slots,
      (select count(*)::int from public.automation_configs where automation_key = 'diaria_recorrente') as daily_configs,
      (select count(*)::int from public.tasks where payload ? 'daily_config_id') as daily_cycles,
      (select count(*)::int from public.drive_creative_workspaces) as creative_workspaces,
      (select count(*)::int from public.drive_capture_workspaces) as capture_workspaces,
      (select count(*)::int from supabase_migrations.schema_migrations) as ledger_count,
      (select max(version) from supabase_migrations.schema_migrations) as ledger_last,
      (select md5(string_agg(version, ',' order by version)) from supabase_migrations.schema_migrations) as ledger_fingerprint`,
    `select version, name from supabase_migrations.schema_migrations where version in
      ('20260925220658', '20260926000000', '20260926010000', '20260926020000') order by version`,
    `select t.key, t.id, t.behavior, v.id as workflow_id, v.version,
      array_agg(s.step_key order by s.order_index) filter (where s.id is not null) as steps
      from public.task_types t
      left join public.workflow_versions v on v.delivery_type_id = t.id and v.status = 'published'
      left join public.workflow_version_steps s on s.workflow_version_id = v.id
      where t.key in ('criativo', 'entrega_reels', 'entrega_story', 'entrega_carrossel', 'entrega_anuncio', 'entrega_banner')
      group by t.key, t.id, t.behavior, v.id, v.version order by t.key`,
    `select parent_id, workflow_step_id, count(*)::int as duplicate_slots from public.task_links
      where relation_kind = 'workflow_step' group by parent_id, workflow_step_id having count(*) > 1`,
    `select client_id, count(*)::int as links, bool_and(raw_folder_id is not null and uploads_folder_id is not null) as ready
      from public.client_drive_links group by client_id order by client_id`,
    `select proname, md5(pg_get_functiondef(oid)) as definition_hash
      from pg_proc where oid in ('public.materialize_recurring_daily(uuid,date,jsonb)'::regprocedure,
      'public.workflow_version_transition_is_valid()'::regprocedure,
      'public.workflow_version_step_is_mutable()'::regprocedure)`,
  ];
  for (const [index, query] of queries.entries()) {
    const { rows } = await db.query(query);
    console.log(JSON.stringify({ section: index + 1, rows }));
  }
  console.log(JSON.stringify({ preflightSqlSha256: createHash("sha256")
    .update(queries.join("\n")).digest("hex") }));
} finally {
  await db.end();
}
