import { createAdminClient } from "./admin";
import { HttpError } from "@/lib/validation";

// Every client created through the admin UI gets a real login automatically,
// so the admin never has to run scripts/create-user.mjs by hand for the
// common case. Fixed default password, shown to the admin once at creation
// time so they can relay it to the client (who is expected to change it).
export const DEFAULT_CLIENT_PASSWORD = "NorthCliente@2026";

export type ClientCredentials = { email: string; password: string };

// Creates the Supabase Auth user (role='client', level='gerente' — full
// access for the client's first/primary login) and its `profiles` row.
export async function provisionClientAuth(input: {
  clientId: string;
  slug: string;
  email: string;
}): Promise<ClientCredentials> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: DEFAULT_CLIENT_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "client", client_id: input.clientId, client_slug: input.slug, level: "gerente" },
  });
  if (error) {
    if (error.status === 422 || /already.*registered/i.test(error.message ?? "")) {
      throw new HttpError(409, "Ja existe uma conta com esse e-mail.");
    }
    throw new HttpError(503, "Nao foi possivel criar o login do cliente.");
  }
  const userId = data.user?.id;
  if (!userId) throw new HttpError(503, "Nao foi possivel criar o login do cliente.");

  // Defensive: handle_new_user reads raw_app_meta_data at INSERT time, which
  // has been observed to occasionally lag behind what admin.createUser() just
  // set (see [[auth-admin-build]] memory) — upsert the profile directly so
  // this never silently depends on trigger timing.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id: userId, role: "client", client_id: input.clientId, level: "gerente", full_name: input.email },
      { onConflict: "id" },
    );
  if (profileError) throw new HttpError(503, "Login criado, mas o perfil nao foi vinculado corretamente.");

  return { email: input.email, password: DEFAULT_CLIENT_PASSWORD };
}
