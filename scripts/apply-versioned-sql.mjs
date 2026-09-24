import { readFileSync } from "node:fs";
import pg from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) throw new Error("Informe o arquivo SQL versionado.");
const envText = readFileSync(".env.local", "utf8");
const match = /^SUPABASE_DB_URL=(.*)$/m.exec(envText);
if (!match) throw new Error("SUPABASE_DB_URL ausente em .env.local.");
let connectionString = match[1].trim();
if ((connectionString.startsWith('"') && connectionString.endsWith('"')) || (connectionString.startsWith("'") && connectionString.endsWith("'"))) {
  connectionString = connectionString.slice(1, -1);
}
const url = new URL(connectionString);
if (!url.hostname.includes("pooler.supabase.com")) throw new Error("SUPABASE_DB_URL precisa apontar para o Session pooler.");
const sql = readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString, statement_timeout: 120_000, application_name: "north-versioned-migration" });
try {
  await client.connect();
  await client.query(sql);
  console.log(`SQL versionado aplicado: ${sqlPath}`);
} finally {
  await client.end().catch(() => undefined);
}
