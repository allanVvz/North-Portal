import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { HttpError } from "./validation";

// Thin wrapper around the vault_* SQL functions (supabase/migrations/20260813000001_credential_vault.sql).
// The functions are SECURITY DEFINER and check is_admin() themselves, so this
// runs on the session-scoped client (same as the rest of lib/supabase.ts) —
// no service-role client needed. Callers must still gate the route with
// requireAdmin()/requireAdminManager() before calling these; the DB check is
// the last line of defense, not the primary one.

function failVault(action: string, error: { message?: string } | null): never {
  console.error(`Vault ${action} error`, { message: error?.message?.slice(0, 240) });
  throw new HttpError(503, "Nao foi possivel acessar o cofre de credenciais.");
}

export async function vaultSet(secret: string, name?: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vault_set_secret", { p_secret: secret, p_name: name ?? null });
  if (error) failVault("set", error);
  return data as string;
}

export async function vaultUpdate(id: string, secret: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vault_update_secret", { p_id: id, p_secret: secret });
  if (error) failVault("update", error);
}

export async function vaultRead(id: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vault_read_secret", { p_id: id });
  if (error) failVault("read", error);
  return (data as string | null) ?? "";
}

export async function vaultDelete(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vault_delete_secret", { p_id: id });
  if (error) failVault("delete", error);
}

// Service-role read — for callers with no session (the automations cron
// route), where createAdminClient() bypasses RLS and vault_authorized()
// grants access via auth.role() = 'service_role'
// (supabase/migrations/20260820000002_automations.sql). Never call this from
// a session-scoped route; use vaultRead() there instead.
export async function vaultReadService(id: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("vault_read_secret", { p_id: id });
  if (error) failVault("read (service)", error);
  return (data as string | null) ?? "";
}
