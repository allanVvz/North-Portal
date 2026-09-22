// Read-only production preflight for 20260922140000.
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL });

await db.connect();
try {
  const { rows } = await db.query(`
    select
      (select count(*)::int
       from public.automation_configs ac join public.tasks t on t.id = ac.target_task_id
       where ac.active and ac.automation_key in ('relatorio_trafego_semanal', 'relatorio_conversao')
         and t.client_id in (
           '4f2bfda6-325d-4da3-94ff-c64802e1e2a4', 'f1bb7a9f-1d92-4304-b43a-0b0ef6c499be',
           '0d6167c2-acb5-4d3b-a0e7-a713f0d3d7a2', 'ef3f86b3-03ee-4e9a-96d5-f897bab1aafa',
           '7698938b-f762-4116-8926-b13abf82d809', '1b479f4d-f7aa-4ec0-a560-e77df4bb2f7a'
         )) as active_configs,
      (select count(*)::int from public.conversion_reports where status <> 'superseded') as current_conversion_reports,
      (select count(*)::int from public.conversion_report_snapshots) as snapshots,
      (select version from supabase_migrations.schema_migrations order by version desc limit 1) as ledger_last;
  `);
  console.log(JSON.stringify(rows[0]));
} finally {
  await db.end();
}
