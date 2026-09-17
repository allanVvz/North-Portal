import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const TASK_ID = "61c24c82-f2a2-5bf9-8459-0e031ebd11f7";
const BUCKET = "documents";

function loadLocalEnv() {
  const text = fs.readFileSync(".env.local", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

loadLocalEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase URL/service key ausentes em .env.local.");

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await supabase
  .from("documents")
  .select("id,storage_path")
  .eq("task_id", TASK_ID);
if (error) throw error;
if (data.length !== 1 || !data[0].storage_path) {
  throw new Error(`Allowlist divergente: esperado 1 objeto Storage, encontrado ${data.length}.`);
}

if (!APPLY) {
  console.log("Dry-run aprovado: 1 objeto allowlisted seria removido. Use --apply no cutover.");
} else {
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([data[0].storage_path]);
  if (removeError) throw removeError;
  console.log("Objeto allowlisted removido do Storage. A linha documents será removida pela migration versionada.");
}
