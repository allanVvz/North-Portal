// Applies 20260922140000 through the verified session pooler connection.
// The SQL owns its BEGIN/COMMIT and aborts atomically on every failed guard.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire(import.meta.url)("pg");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL });

await db.connect();
try {
  await db.query(readFileSync(new URL("../supabase/migrations/20260922140000_segment_report_templates.sql", import.meta.url), "utf8"));
  console.log("20260922140000 applied");
} finally {
  await db.end();
}
