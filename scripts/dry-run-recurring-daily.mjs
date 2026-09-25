// Compiles the versioned DDL on production and always rolls the transaction back.
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const sql = readFileSync("supabase/migrations/20260925220658_recurring_daily_materials.sql", "utf8")
  .replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-daily-ddl-dry-run" });
await db.connect();
try {
  await db.query("begin");
  await db.query(sql);
  const { rows } = await db.query("select count(*)::int as function_count from pg_proc where proname='materialize_recurring_daily'");
  console.log(JSON.stringify({ migrationCompiled: rows[0].function_count === 1, rolledBack: true }));
} finally {
  await db.query("rollback").catch(() => undefined);
  await db.end();
}
