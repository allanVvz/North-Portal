// Read-only postflight; run once before and once after writing the ledger.
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-formats-postflight" });
await db.connect();
try {
  const { rows: types } = await db.query(`select t.key, t.behavior, v.id as version_id, v.version,
    array_agg(s.step_key order by s.order_index) as steps,
    (array_agg(s.task_type_id order by s.order_index))[1] as script_type_id,
    max(s.task_type_id::text) filter (where s.step_key='captacao') as capture_type_id
    from public.task_types t
    join public.workflow_versions v on v.delivery_type_id=t.id and v.status='published'
    join public.workflow_version_steps s on s.workflow_version_id=v.id
    where t.key in ('criativo','entrega_reels','entrega_story','entrega_carrossel','entrega_anuncio','entrega_banner')
    group by t.key,t.behavior,v.id,v.version order by t.key`);
  const base = types.find((type) => type.key === "criativo");
  const formats = types.filter((type) => type.key !== "criativo");
  if (!base || formats.length !== 5 || formats.some((type) => type.behavior !== "entrega" ||
      type.steps[0] !== "roteiro" || !type.steps.includes("captacao") ||
      type.script_type_id !== base.script_type_id || type.capture_type_id !== base.capture_type_id)) {
    throw new Error("As cinco cascatas não são equivalentes à estrutura compartilhada da diária.");
  }
  const { rows: functions } = await db.query(`select proname, prosecdef, pg_get_functiondef(oid) as definition
    from pg_proc where oid in ('public.materialize_recurring_daily(uuid,date,jsonb)'::regprocedure,
    'public.publish_delivery_workflow(uuid,jsonb)'::regprocedure)`);
  const materialize = functions.find((fn) => fn.proname === "materialize_recurring_daily");
  const editor = functions.find((fn) => fn.proname === "publish_delivery_workflow");
  if (!materialize?.definition.includes("piece_workflow_id") || !editor || editor.prosecdef) {
    throw new Error("As funções versionadas não estão equivalentes ao contrato esperado.");
  }
  const { rows: ledger } = await db.query(`select version, name from supabase_migrations.schema_migrations
    where version='20260926020000'`);
  console.log(JSON.stringify({ formats: formats.map(({ key, version, steps }) => ({ key, version, steps })),
    functionNames: functions.map((fn) => fn.proname), ledger: ledger[0] ?? null }));
} finally {
  await db.end();
}
