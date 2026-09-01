// Leitura service-role da credencial do provedor de IA — espelho de
// getWindsorSettingsService/getMetaSettingsService (lib/automations/
// serviceIntegrations.ts). getAiProviderSettings() de lib/supabase.ts usa
// vaultRead (com sessão) e não serve ao cron.

import { createAdminClient } from "@/lib/supabase/admin";
import { vaultReadService } from "@/lib/vault";
import type { AiVendor } from "@/lib/aiProviders";

export type ServiceAiSettings = { apiKey: string; vendor: AiVendor | null };

/** `null` quando não há credencial de IA cadastrada (Configurações ›
 *  Integrações › Provedor de IA) ou a chave está vazia. */
export async function getAiProviderSettingsService(): Promise<ServiceAiSettings | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_credentials")
    .select("vault_secret_id,meta")
    .eq("provider", "ai")
    .eq("scope", "agency")
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { vault_secret_id: string; meta: { vendor?: AiVendor | null } | null } | undefined;
  if (!row) return null;
  const apiKey = await vaultReadService(row.vault_secret_id);
  if (!apiKey) return null;
  return { apiKey, vendor: row.meta?.vendor ?? null };
}
