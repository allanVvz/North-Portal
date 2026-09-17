// Leitura service-role da credencial do provedor de IA — espelho de
// getWindsorSettingsService/getMetaSettingsService (lib/automations/
// serviceIntegrations.ts). getAiProviderSettings() de lib/supabase.ts usa
// vaultRead (com sessão) e não serve ao cron.

import { createAdminClient } from "@/lib/supabase/admin";
import { vaultReadService } from "@/lib/vault";
import type { AiVendor } from "@/lib/aiProviders";

export type ServiceAiSettings = { apiKey: string; vendor: AiVendor };

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
  const row = data?.[0] as { vault_secret_id: string } | undefined;
  if (!row) return null;
  const apiKey = await vaultReadService(row.vault_secret_id);
  if (!apiKey) return null;
  // The credential is agency-wide and OpenAI-only.  Do not infer a provider
  // from old metadata: a null/invalid legacy value must never route to another
  // network provider.
  return { apiKey, vendor: "openai" };
}
