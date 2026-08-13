import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getSupabaseProjectRef, loadEnvLocal } from "./lib/env.mjs";

loadEnvLocal();

const action = process.argv[2];
if (!new Set(["link", "migrate", "seed"]).has(action)) {
  console.error("Usage: node scripts/supabase-cloud.mjs <link|migrate|seed>");
  process.exit(2);
}

let projectRef;
try {
  projectRef = getSupabaseProjectRef();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const require = createRequire(import.meta.url);
const executable = process.platform === "win32"
  ? join(
      dirname(require.resolve(`@supabase/cli-windows-${process.arch}/package.json`)),
      "bin",
      "supabase.exe",
    )
  : "supabase";

function run(args) {
  const result = spawnSync(executable, args, { stdio: "inherit", env: process.env, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["link", "--project-ref", projectRef]);

if (action === "migrate") {
  run(["db", "push", "--linked"]);
} else if (action === "seed") {
  // Supabase CLI applies configured seed files with db push. Because seed.sql is
  // idempotent, this is safe whether or not pending migrations also exist.
  run(["db", "push", "--linked", "--include-seed"]);
}
