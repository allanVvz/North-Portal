// Catalog/data equivalence check before recording the migration ledger.
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-schema-verify" });
await db.connect();
try {
  const { rows } = await db.query(`select
    (select count(*)::int from information_schema.columns where table_schema='public'
      and table_name='automation_configs' and column_name='daily_config' and data_type='jsonb') as column_count,
    (select count(*)::int from pg_constraint where conrelid='public.automation_configs'::regclass
      and conname='automation_configs_daily_config_check') as check_count,
    (select pg_get_constraintdef(oid) like '%diaria_recorrente%' from pg_constraint
      where conrelid='public.automation_configs'::regclass
      and conname='automation_configs_automation_key_check') as key_supported,
    (select count(*)::int from pg_indexes where schemaname='public'
      and indexname='automation_configs_daily_target_idx') as index_count,
    (select count(*)::int from pg_proc where oid='public.materialize_recurring_daily(uuid,date,jsonb)'::regprocedure) as function_count,
    (select has_function_privilege('anon','public.materialize_recurring_daily(uuid,date,jsonb)','execute')) as anon_execute,
    (select has_function_privilege('authenticated','public.materialize_recurring_daily(uuid,date,jsonb)','execute')) as authenticated_execute,
    (select has_function_privilege('service_role','public.materialize_recurring_daily(uuid,date,jsonb)','execute')) as service_execute,
    (select count(*)::int from public.automation_configs where automation_key='diaria_recorrente') as daily_configs,
    (select count(*)::int from public.drive_capture_workspaces) as capture_workspaces,
    (select count(*)::int from public.drive_creative_workspaces) as creative_workspaces,
    (select count(*)::int from supabase_migrations.schema_migrations where version='20260925220658') as ledger_rows;`);
  const result = rows[0];
  console.log(JSON.stringify(result));
  if (result.column_count !== 1 || result.check_count !== 1 || !result.key_supported ||
      result.index_count !== 1 || result.function_count !== 1 || result.anon_execute ||
      result.authenticated_execute || !result.service_execute || result.daily_configs !== 0 ||
      result.capture_workspaces !== 2 || result.creative_workspaces !== 9) {
    throw new Error("Schema ou dados não equivalentes à migration versionada.");
  }
} finally {
  await db.end();
}
