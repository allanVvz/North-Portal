import { NextResponse } from "next/server";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { apiError } from "@/lib/api";
import { getCachedInsights, getClient, getWindsorSettings, upsertInsightsCache } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { performanceInsightsQuerySchema } from "@/lib/validation";
import { fetchWindsorPosts, type MetaPost, type WindsorDatasource } from "@/lib/windsor";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h; ?refresh=1 bypasses
const WINDOW_DAYS = 90; // always fetch a 90-day window so period switching is free

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// GET /api/admin/performance/insights?from&to[&client][&refresh=1]
// No API key configured → demo dataset. Otherwise: per enabled datasource ×
// mapped account, serve from meta_insights_cache when fresh, else fetch
// Windsor and refill. A Windsor failure with stale cache available degrades
// to the stale data (flagged) instead of a 5xx.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const q = performanceInsightsQuerySchema.parse(Object.fromEntries(url.searchParams));

    const settings = await getWindsorSettings();
    const inRange = (p: MetaPost) => p.date >= q.from && p.date <= q.to;

    if (!settings.apiKey) {
      return NextResponse.json({
        demo: true,
        stale: false,
        posts: generateDemoPosts().filter(inRange),
        datasources: settings.datasources,
        fetchedAt: null,
      });
    }

    // Which accounts to serve: one client's mapped account, or all mapped.
    let accountFilter: string[] | null = null;
    if (q.client) {
      const client = await getClient(q.client, true);
      const mapped = client ? settings.accountMap[q.client] : null;
      accountFilter = mapped ? [mapped.accountId] : [];
    }

    const accountToClientId = new Map<string, string | null>();
    for (const [slug, ref] of Object.entries(settings.accountMap)) {
      if (ref) {
        const client = await getClient(slug, true);
        accountToClientId.set(ref.accountId, client?.id ?? null);
      }
    }

    const enabled = (Object.keys(settings.datasources) as WindsorDatasource[]).filter((ds) => settings.datasources[ds]);
    const cache = await getCachedInsights();
    const now = Date.now();
    const today = new Date();
    const windowFrom = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - WINDOW_DAYS));
    const windowTo = isoDay(today);

    const posts: MetaPost[] = [];
    let oldestFetch: string | null = null;
    let stale = false;
    let staleError: string | undefined;

    // Group work per datasource — one Windsor call covers every account of
    // that datasource, so refresh cost is O(datasources), not O(accounts).
    for (const ds of enabled) {
      const dsRows = cache.filter((r) => r.datasource === ds);
      const fresh = dsRows.length > 0 &&
        dsRows.every((r) => now - new Date(r.fetched_at).getTime() < CACHE_TTL_MS && r.date_from <= q.from);

      if (fresh && !q.refresh) {
        for (const row of dsRows) {
          posts.push(...row.payload.filter(inRange));
          if (!oldestFetch || row.fetched_at < oldestFetch) oldestFetch = row.fetched_at;
        }
        continue;
      }

      try {
        const fetched = await fetchWindsorPosts(settings.apiKey, ds, windowFrom, windowTo);
        const byAccount = new Map<string, MetaPost[]>();
        for (const p of fetched) {
          const list = byAccount.get(p.accountId);
          if (list) list.push(p); else byAccount.set(p.accountId, [p]);
        }
        for (const [accountId, accountPosts] of byAccount) {
          await upsertInsightsCache({
            client_id: accountToClientId.get(accountId) ?? null,
            account_id: accountId,
            datasource: ds,
            date_from: windowFrom,
            date_to: windowTo,
            payload: accountPosts,
          });
        }
        posts.push(...fetched.filter(inRange));
        oldestFetch = new Date().toISOString();
      } catch (error) {
        // Degrade to stale cache when we have one; only hard-fail without it.
        if (dsRows.length > 0) {
          stale = true;
          staleError = error instanceof Error ? error.message : "Falha ao atualizar dados da Windsor.";
          for (const row of dsRows) {
            posts.push(...row.payload.filter(inRange));
            if (!oldestFetch || row.fetched_at < oldestFetch) oldestFetch = row.fetched_at;
          }
        } else {
          throw error;
        }
      }
    }

    const filtered = accountFilter === null ? posts : posts.filter((p) => accountFilter.includes(p.accountId));

    return NextResponse.json({
      demo: false,
      stale,
      ...(staleError ? { error: staleError } : {}),
      posts: filtered,
      datasources: settings.datasources,
      fetchedAt: oldestFetch,
    });
  } catch (error) {
    return apiError(error);
  }
}
