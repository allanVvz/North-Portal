import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();

let env;
try {
  env = requireEnv([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEMO_ADMIN_EMAIL",
    "DEMO_ADMIN_PASSWORD",
    "DEMO_CLIENT_EMAIL",
    "DEMO_CLIENT_PASSWORD",
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUser(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

async function upsertDemoUser({ email, password, role, clientId = null, clientSlug = null }) {
  const appMetadata = { role };
  if (role === "client") {
    appMetadata.client_id = clientId;
    appMetadata.client_slug = clientSlug;
  }

  const existing = await findUser(email);
  const response = existing
    ? await supabase.auth.admin.updateUserById(existing.id, {
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
      });

  if (response.error) throw response.error;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: response.data.user.id,
      role,
      client_id: clientId,
      level: role === "admin" ? "gerente" : "usuario",
      full_name: role === "admin" ? "Admin Demo" : "Cliente Demo",
    },
    { onConflict: "id" },
  );
  if (profileError) throw profileError;

  console.log(`${existing ? "Updated" : "Created"} ${role} demo user.`);
}

try {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, slug")
    .eq("slug", "cliente-demo")
    .single();
  if (clientError) throw new Error("Demo client not found. Run npm run db:seed first.", { cause: clientError });

  await upsertDemoUser({
    email: env.DEMO_ADMIN_EMAIL,
    password: env.DEMO_ADMIN_PASSWORD,
    role: "admin",
  });
  await upsertDemoUser({
    email: env.DEMO_CLIENT_EMAIL,
    password: env.DEMO_CLIENT_PASSWORD,
    role: "client",
    clientId: client.id,
    clientSlug: client.slug,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
