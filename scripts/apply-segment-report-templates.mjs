// Applies a versioned report migration through the verified session pooler.
// The SQL owns its BEGIN/COMMIT and aborts atomically on every failed guard.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL });
const migration = process.argv[2] ?? "20260922140000_segment_report_templates.sql";
if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(migration)) throw new Error("Nome de migration inválido.");

await db.connect();
try {
  await db.query(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  console.log(`${migration} applied`);
} finally {
  await db.end();
}
