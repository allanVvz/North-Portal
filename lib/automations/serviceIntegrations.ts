// Service-role mirrors of getWindsorSettings()/getMetaSettings()
// (lib/supabase.ts) — those two are session-scoped (createClient() from
// lib/supabase/server), unusable from the cron route which has no session.
// Same query/shape, admin client + vaultReadService() instead.

import { createAdminClient } from "@/lib/supabase/admin";
import { vaultReadService } from "@/lib/vault";
import { WINDSOR_SETTINGS_DEFAULT, type WindsorSettings } from "@/lib/windsor";
import type { MetaAdAccount } from "@/lib/meta";

type WindsorMeta = { datasources?: Partial<WindsorSettings["datasources"]>; accountMap?: WindsorSettings["accountMap"] };
type MetaMeta = { accountMap?: Record<string, MetaAdAccount | null> };

export async function getWindsorSettingsService(): Promise<WindsorSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_credentials")
    .select("vault_secret_id,meta")
    .eq("provider", "windsor")
    .eq("scope", "agency")
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { vault_secret_id: string; meta: WindsorMeta | null } | undefined;
  if (!row) return { ...WINDSOR_SETTINGS_DEFAULT };
  const apiKey = await vaultReadService(row.vault_secret_id);
  const meta = row.meta ?? {};
  return {
    apiKey,
    datasources: { ...WINDSOR_SETTINGS_DEFAULT.datasources, ...(meta.datasources ?? {}) },
    accountMap: meta.accountMap ?? {},
  };
}

export type ServiceMetaSettings = {
  configured: boolean;
  accessToken: string | null;
  accountMap: Record<string, MetaAdAccount | null>;
};

export async function getMetaSettingsService(): Promise<ServiceMetaSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_credentials")
    .select("vault_secret_id,meta,status")
    .eq("provider", "meta")
    .eq("scope", "agency")
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { vault_secret_id: string; meta: MetaMeta | null; status: string } | undefined;
  if (!row || row.status !== "connected") return { configured: false, accessToken: null, accountMap: {} };
  const accessToken = (await vaultReadService(row.vault_secret_id)) || null;
  return { configured: Boolean(accessToken), accessToken, accountMap: row.meta?.accountMap ?? {} };
}

export type ClientLite = { id: string; slug: string; name: string };

export async function getClientById(clientId: string): Promise<ClientLite | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("clients").select("id,slug,name").eq("id", clientId).limit(1);
  if (error) throw error;
  return (data?.[0] as ClientLite | undefined) ?? null;
}

// A client is eligible for the ads-report automation (Automação 1) if a
// Windsor or Meta ad account is mapped to it — same rule already used by
// app/api/admin/performance/insights/route.ts:49-73, just resolved for one
// specific client (the target card's own client) instead of scanning all.
export type AdsAccountRef = { windsorAccountId: string | null; metaAccountId: string | null; metaAccountName: string | null };

export function adsAccountFor(slug: string, windsor: WindsorSettings, meta: ServiceMetaSettings): AdsAccountRef | null {
  const windsorRef = windsor.accountMap[slug];
  const metaRef = meta.accountMap[slug];
  if (!windsorRef && !metaRef) return null;
  return {
    windsorAccountId: windsorRef?.accountId ?? null,
    metaAccountId: metaRef?.accountId ?? null,
    metaAccountName: metaRef?.accountName ?? null,
  };
}

// Automação 2 eligibility: any client with at least one task_metrics row.
export async function listMetricsEligibleClientIds(): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("task_metrics").select("client_id");
  if (error) throw error;
  return new Set((data ?? []).map((row) => (row as { client_id: string }).client_id));
}
