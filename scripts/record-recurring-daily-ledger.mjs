// Record only the already-applied, catalog-verified migration.
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) {
  throw new Error("Use o Session pooler.");
}
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-ledger" });
await db.connect();
try {
  await db.query("begin");
  const { rows: [state] } = await db.query(`select
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
    (select count(*)::int from supabase_migrations.schema_migrations where version='20260925220658') as ledger_rows`);
  if (state.column_count !== 1 || state.check_count !== 1 || !state.key_supported ||
      state.index_count !== 1 || state.function_count !== 1 || state.anon_execute ||
      state.authenticated_execute || !state.service_execute || state.ledger_rows !== 0) {
    throw new Error("Schema/ledger divergente; registro cancelado.");
  }
  const { rows: columns } = await db.query(`select column_name,data_type,is_nullable,column_default
    from information_schema.columns where table_schema='supabase_migrations'
    and table_name='schema_migrations' order by ordinal_position`);
  const required = columns.filter((column) => column.is_nullable === "NO" && column.column_default === null)
    .map((column) => column.column_name);
  if (required.some((column) => !["version", "statements"].includes(column))) {
    throw new Error(`Colunas obrigatórias inesperadas no ledger: ${required.join(",")}`);
  }
  await db.query(`insert into supabase_migrations.schema_migrations (version, statements, name)
    values ($1, $2::text[], $3)`, ["20260925220658", [], "recurring_daily_materials"]);
  await db.query("commit");
  console.log(JSON.stringify({ version: "20260925220658", recorded: true }));
} catch (error) {
  await db.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await db.end();
}
