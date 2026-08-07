// Matches existing free-text `tasks.assignee` values against the real North
// team accounts (Allan/Cintia/Luiza/Alisson) and links them via
// task_assignees — additive/idempotent (safe to re-run). Defaults to
// dry-run (prints matches, writes nothing); pass --apply to actually write.
//
// Deliberately does NOT touch reviewer_id/approver_id — there is no way to
// infer that a generic test account (e.g. admin@north.com) "secretly was"
// one of these people on a specific task. That realignment is manual.
//
// Usage:
//   node scripts/link-assignees-to-accounts.mjs            (dry-run)
//   node scripts/link-assignees-to-accounts.mjs --apply     (writes)
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or from .env.local.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* .env.local optional */
  }
}
loadEnvLocal();

const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Same split/trim/dedupe rules as lib/assignees.ts — kept in sync manually,
// this script is intentionally self-contained (no TS import from a plain
// Node script, same pattern as the other scripts/ files).
function parseAssignees(value) {
  if (!value) return [];
  const unique = new Map();
  for (const raw of value.split(",")) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase("pt-BR");
    if (name && !unique.has(key)) unique.set(key, name);
  }
  return Array.from(unique.values());
}
function formatAssignees(names) {
  return parseAssignees(names.join(",")).join(", ");
}

const PATTERNS = [
  { fullName: "Allan", pattern: /^allan$/i },
  { fullName: "Cintia", pattern: /^c[ií]nt[yi]a$/i },
  { fullName: "Luiza", pattern: /^lu[ií]za$/i },
  { fullName: "Alisson", pattern: /^al[ié]ss?on$/i },
];

const { data: accountRows, error: accErr } = await supabase
  .from("profiles")
  .select("id,full_name")
  .eq("role", "admin")
  .in("full_name", PATTERNS.map((p) => p.fullName));
if (accErr) throw accErr;

const accountByName = new Map(
  PATTERNS.map((p) => {
    const row = (accountRows ?? []).find((r) => r.full_name === p.fullName);
    return [p.fullName, row ? { id: row.id, pattern: p.pattern } : null];
  }),
);
const missing = PATTERNS.filter((p) => !accountByName.get(p.fullName));
if (missing.length) {
  console.error("Contas nao encontradas (crie antes de rodar este script):", missing.map((m) => m.fullName).join(", "));
  process.exit(1);
}

const { data: tasks, error: taskErr } = await supabase.from("tasks").select("id,title,assignee").not("assignee", "is", null);
if (taskErr) throw taskErr;

const plan = [];
for (const task of tasks ?? []) {
  const names = parseAssignees(task.assignee);
  const matches = [];
  const remaining = [];
  for (const name of names) {
    const found = [...accountByName.entries()].find(([, acc]) => acc.pattern.test(name));
    if (found) matches.push({ name, personName: found[0], profileId: found[1].id });
    else remaining.push(name);
  }
  if (matches.length) plan.push({ taskId: task.id, title: task.title, matches, remainingAssignee: formatAssignees(remaining) || null });
}

console.log(`${plan.length} tarefa(s) com correspondencia:`);
for (const p of plan) {
  console.log(`- [${p.taskId}] "${p.title}": ${p.matches.map((m) => `${m.name} -> ${m.personName}`).join(", ")}`);
}

if (!plan.length) process.exit(0);

if (!apply) {
  console.log("\nDry-run (nenhuma escrita). Rode com --apply para aplicar.");
  process.exit(0);
}

for (const p of plan) {
  const { data: existingLinks, error: linkErr } = await supabase.from("task_assignees").select("profile_id").eq("task_id", p.taskId);
  if (linkErr) throw linkErr;
  const existingIds = new Set((existingLinks ?? []).map((r) => r.profile_id));
  const newIds = p.matches.map((m) => m.profileId).filter((id) => !existingIds.has(id));
  if (newIds.length) {
    const { error: insErr } = await supabase.from("task_assignees").insert(newIds.map((profile_id) => ({ task_id: p.taskId, profile_id })));
    if (insErr) throw insErr;
  }
  const { error: updErr } = await supabase.from("tasks").update({ assignee: p.remainingAssignee }).eq("id", p.taskId);
  if (updErr) throw updErr;
}
console.log(`\n${plan.length} tarefa(s) atualizadas.`);
