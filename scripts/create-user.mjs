// Create a Supabase Auth user with the right role metadata.
// Usage:
//   node scripts/create-user.mjs admin@north.com "Senha123!" admin
//   node scripts/create-user.mjs cliente@karpinski.com "Senha123!" client karpinski
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment or from .env.local. The handle_new_user trigger creates the profile.

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

const [email, password, role = "client", slug] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <password> <admin|client> [slug]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const app_metadata = { role };
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
console.log("Created user:", data.user?.id, "role:", role, slug ? `slug: ${slug}` : "");
