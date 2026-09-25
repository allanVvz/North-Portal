// Read-only production preflight for 20260925220658.
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const uri = new URL(SUPABASE_DB_URL);
if (!uri.hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-preflight" });
await db.connect();
try {
  const { rows } = await db.query(`
    select
      (select count(*)::int from public.task_links
       where slot is not null and btrim(slot) = '') as invalid_slots,
      (select count(*)::int from public.automation_configs
       where automation_key = 'diaria_recorrente') as daily_configs,
      (select count(*)::int from public.drive_capture_workspaces) as capture_workspaces,
      (select count(*)::int from public.drive_creative_workspaces) as creative_workspaces,
      (select count(*)::int from public.tasks
       where id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd') as baita_plan,
      (select jsonb_build_object('kind', kind, 'recurrence', recurrence_cadence,
                                 'client_id', client_id, 'plan_id', plan_id)
       from public.tasks where id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd') as baita_shape,
      (select count(*)::int from public.task_links
       where parent_id = '7e1a162d-ff0f-414e-ad50-bea8b472fbcd'
         and relation_kind = 'structural_member') as baita_members,
      (select jsonb_build_object('kind', kind, 'recurrence', recurrence_cadence,
                                 'client_id', client_id)
       from public.tasks where id = '71e87469-990b-416e-9d0e-a6f57e781343') as baita_template_shape,
      (select jsonb_agg(jsonb_build_object('key', s.step_key, 'order', s.order_index)
                        order by s.order_index)
       from public.workflow_version_steps s
       join public.workflow_versions v on v.id = s.workflow_version_id
       join public.task_types t on t.id = v.delivery_type_id
       where t.key = 'criativo' and v.status = 'published') as creative_steps,
      (select version from supabase_migrations.schema_migrations
       order by version desc limit 1) as ledger_last,
      (select count(*)::int from supabase_migrations.schema_migrations) as ledger_count,
      (select jsonb_agg(column_name order by ordinal_position)
       from information_schema.columns where table_schema='supabase_migrations'
       and table_name='schema_migrations') as ledger_columns,
      (select md5(string_agg(version, ',' order by version))
       from supabase_migrations.schema_migrations) as ledger_fingerprint,
      (select count(*)::int from supabase_migrations.schema_migrations
       where version = '20260925220658') as migration_already_recorded,
      (select count(*)::int from information_schema.columns
       where table_schema = 'public' and table_name = 'automation_configs'
         and column_name = 'daily_config') as daily_column_present,
      (select pg_get_constraintdef(oid) from pg_constraint
       where conname = 'automation_configs_automation_key_check'
         and conrelid = 'public.automation_configs'::regclass) as automation_key_constraint;
  `);
  console.log(JSON.stringify(rows[0]));
} finally {
  await db.end();
}
