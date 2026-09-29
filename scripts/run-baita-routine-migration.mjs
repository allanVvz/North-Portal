// Executes the versioned migration with a reversible dry run first.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const pg = createRequire("/tmp/north-db/package.json")("pg");
const mode = process.argv[2];
if (!['--dry-run', '--dry-run-rollback', '--apply', '--postflight', '--record-ledger'].includes(mode)) throw new Error("Use --dry-run, --dry-run-rollback, --apply, --postflight ou --record-ledger.");
const path = "supabase/migrations/20260929042154_baita_routine_and_piece_reviews.sql";
const sql = readFileSync(path, "utf8");
const rollbackSql = readFileSync("supabase/rollback/20260929042154_baita_routine_and_piece_reviews.sql", "utf8");
const postflightSql = readFileSync("supabase/postflight/20260929042154_baita_routine_and_piece_reviews.sql", "utf8");
if (!/\bbegin;/.test(sql) || !/\bcommit;\s*$/.test(sql)) throw new Error("Migração precisa ser transacional.");
const inner = (source) => source.replace(/\bbegin;/, "").replace(/\bcommit;\s*$/, "");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, statement_timeout: 120_000, application_name: "north-baita-routine-migration" });
await db.connect();
try {
  if (mode === '--dry-run' || mode === '--dry-run-rollback') {
    await db.query("begin");
    try {
      const beforeNotifications = Number((await db.query("select count(*)::int as n from public.notifications")).rows[0].n);
      await db.query(inner(sql));
      await db.query(postflightSql);
      await db.query("savepoint recurrence_guard_probe");
      let recurrenceRejected = false;
      try {
        await db.query("update public.tasks set plan_id='71e87469-990b-416e-9d0e-a6f57e781343' where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd'");
      } catch (error) { recurrenceRejected = error.code === "23514"; }
      await db.query("rollback to savepoint recurrence_guard_probe");
      if (!recurrenceRejected) throw new Error("A regra de recorrência cross-client não bloqueou a substituição.");
      const afterNotifications = Number((await db.query("select count(*)::int as n from public.notifications")).rows[0].n);
      if (afterNotifications !== beforeNotifications) throw new Error(`A reorganização criou ${afterNotifications - beforeNotifications} notificações.`);
      const { rows } = await db.query(`select
        (select count(*) from public.task_links where parent_id='e5f32ccc-154a-4d11-b5dc-1098bec58fcc' and child_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd') as north_membership,
        (select count(*) from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and plan_id is null and not (payload ? 'recurrence_parent_id')) as baita_detached,
        (select count(*) from public.tasks where payload ? 'legacy_shared_stage_id') as individual_edits,
        (select count(*) from public.task_links where child_id in ('8393b20d-81e3-4b9d-8731-750bc3fb0ae3','d9f87cf5-3437-4797-98cf-44818d03ffa2') and relation_kind='workflow_step') as old_edit_links`);
      console.log(JSON.stringify({ mode, postflight: rows[0] }));
      if (mode === '--dry-run-rollback') {
        await db.query(inner(rollbackSql));
        const restored = (await db.query(`select
          (select count(*) from public.tasks where id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' and plan_id='71e87469-990b-416e-9d0e-a6f57e781343') as original_recurrence,
          (select count(*) from public.task_links where child_id in ('8393b20d-81e3-4b9d-8731-750bc3fb0ae3','d9f87cf5-3437-4797-98cf-44818d03ffa2') and relation_kind='workflow_step') as original_edit_links,
          (select count(*) from public.tasks where payload ? 'legacy_shared_stage_id') as new_edits_left`)).rows[0];
        if (Number(restored.original_recurrence) !== 1 || Number(restored.original_edit_links) !== 8 || Number(restored.new_edits_left) !== 0) throw new Error(`Rollback incomplete: ${JSON.stringify(restored)}`);
        console.log(JSON.stringify({ mode, restored }));
      }
    } finally { await db.query("rollback"); }
  } else {
    if (mode === '--apply') {
      await db.query(sql);
      console.log(JSON.stringify({ mode, applied: path }));
    }
    await db.query(postflightSql);
    console.log(JSON.stringify({ mode, postflight: "pass" }));
    if (mode === '--record-ledger') {
      await db.query("begin");
      try {
        const { rows } = await db.query("select version from supabase_migrations.schema_migrations order by version desc limit 1 for update");
        if (rows[0]?.version !== '20260927185112') throw new Error(`Ledger moved: ${rows[0]?.version}`);
        await db.query("insert into supabase_migrations.schema_migrations(version,name,created_by) values($1,$2,$3)",
          ["20260929042154", "baita_routine_and_piece_reviews", "codex"]);
        await db.query("commit");
      } catch (error) { await db.query("rollback"); throw error; }
      console.log(JSON.stringify({ mode, recorded: "20260929042154" }));
    }
  }
} finally { await db.end(); }
