// Create a Supabase Auth user with the right role metadata.
// Usage:
//   node scripts/create-user.mjs admin@north.com "Senha123!" admin [editor|gerente]
//   node scripts/create-user.mjs cliente@karpinski.com "Senha123!" client karpinski [usuario|gerente]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or from .env.local. The handle_new_user trigger creates the
// profile — level defaults to 'editor' (admin) / 'usuario' (client) when omitted.

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

const [email, password, role = "client", arg4, arg5] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <password> <admin|client> [slug] [level]');
  process.exit(1);
}
// For admin, the 4th arg (if any) is the level; for client, it's the slug and
// the 5th arg (if any) is the level.
const slug = role === "client" ? arg4 : undefined;
const level = role === "client" ? arg5 : arg4;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const app_metadata = { role };
if (level) app_metadata.level = level;
if (role === "client") {
  if (!slug) throw new Error("client role requires a slug argument.");
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, slug")
    .eq("slug", slug)
    .limit(1);
  if (error) throw error;
  if (!clients?.length) throw new Error(`No client found with slug "${slug}". Create the client first.`);
  app_metadata.client_id = clients[0].id;
  app_metadata.client_slug = clients[0].slug;
}

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata,
});
if (error) throw error;

// Defensive: handle_new_user reads raw_app_meta_data at INSERT time, which
// has been observed to occasionally lag behind what admin.createUser() just
// set — upsert the profile directly so this never silently depends on
// trigger timing (see [[auth-admin-build]] memory for the reproduced bug).
const { error: profileError } = await supabase.from("profiles").upsert(
  {
    id: data.user.id,
    role,
    client_id: app_metadata.client_id ?? null,
    level: app_metadata.level ?? (role === "admin" ? "editor" : "usuario"),
    full_name: email,
  },
  { onConflict: "id" },
);
if (profileError) throw profileError;

console.log("Created user:", data.user?.id, "role:", role, slug ? `slug: ${slug}` : "");
