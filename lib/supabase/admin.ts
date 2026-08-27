import { createClient } from "@supabase/supabase-js";

// Service-role client — SERVER ONLY. Bypasses RLS. Use exclusively for
// privileged admin operations (creating auth users, provisioning client rows).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase service role env missing.");
  // DIAGNÓSTICO TEMPORÁRIO — só a claim "role" do JWT, nunca o valor da
  // chave. Remover depois de confirmar se SUPABASE_SERVICE_ROLE_KEY na
  // Vercel é mesmo a service_role ou se ficou com a anon por engano.
  try {
    const payload = JSON.parse(Buffer.from(serviceKey.split(".")[1], "base64url").toString());
    console.error("[diag] SUPABASE_SERVICE_ROLE_KEY role claim:", payload.role);
  } catch {
    console.error("[diag] SUPABASE_SERVICE_ROLE_KEY não parece um JWT (formato novo sb_secret_...?)");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
