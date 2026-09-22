import { NextResponse } from "next/server";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { apiError } from "@/lib/api";
import { getCachedInsights, getClientsBySlugs, getMetaAccessToken, getMetaSettings, getWindsorSettings, upsertInsightsCache } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { performanceInsightsQuerySchema } from "@/lib/validation";
import { fetchWindsorPosts, type MetaPost, type WindsorDatasource } from "@/lib/windsor";
import { fetchMetaAdsInsights, META_ADS_DATASOURCE, META_ADS_SCHEMA_VERSION } from "@/lib/metaInsights";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h; ?refresh=1 bypasses
// One unit of "go get posts for this account under this datasource". Windsor
// covers every account of a datasource in one call (grouped below); the
// direct Meta connection is one call per mapped ad account — both shapes
// share the same cache-by-(account_id,datasource) contract, so the fetch/
// cache/degrade loop further down doesn't need to know which provider it is.
type Provider = { datasource: string; accountId: string; clientId: string | null; fetch: (from: string, to: string) => Promise<MetaPost[]> };

// GET /api/admin/performance/insights?from&to[&client][&refresh=1]
// Neither Windsor nor the direct Meta connection configured → demo dataset.
// Otherwise: per provider (Windsor datasource, or Meta-mapped ad account),
// serve from meta_insights_cache when fresh, else fetch and refill. A
// provider failure with stale cache available degrades to the stale data
// (flagged) instead of a 5xx.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const q = performanceInsightsQuerySchema.parse(Object.fromEntries(url.searchParams));

    const windsor = await getWindsorSettings();
    const meta = await getMetaSettings();
    const inRange = (p: MetaPost) => p.date >= q.from && p.date <= q.to;

    if (!windsor.apiKey && !meta.configured) {
      return NextResponse.json({
        demo: true,
        stale: false,
        posts: generateDemoPosts().filter(inRange),
        datasources: { ...windsor.datasources, [META_ADS_DATASOURCE]: false },
        fetchedAt: null,
      });
    }

    // Resolve every configured slug in one query. The previous nested loops
    // called getClient serially (and Meta did it a second time), so latency
    // grew with the number of configured clients even for one-client views.
    const mappedSlugs = [...new Set([
      ...Object.keys(windsor.accountMap),
      ...Object.keys(meta.accountMap),
    ])];
    const clientsBySlug = await getClientsBySlugs(mappedSlugs, true);

    // Which accounts to serve: one client's mapped account(s), or all mapped.
    let accountFilter: string[] | null = null;
    let requestedWindsorAccountId: string | null = null;
    let requestedMetaAccountId: string | null = null;
    if (q.client) {
      const ids: string[] = [];
      const client = clientsBySlug.get(q.client);
      const windsorMapped = client ? windsor.accountMap[q.client] : null;
      const metaMapped = client ? meta.accountMap[q.client] : null;
      requestedWindsorAccountId = windsorMapped?.accountId ?? null;
      requestedMetaAccountId = metaMapped?.accountId ?? null;
      if (requestedWindsorAccountId) ids.push(requestedWindsorAccountId);
      if (requestedMetaAccountId) ids.push(requestedMetaAccountId);
      accountFilter = [...new Set(ids)];
    }

    const accountToClientId = new Map<string, string | null>();
    for (const [slug, ref] of Object.entries(windsor.accountMap)) {
      if (ref) {
        const client = clientsBySlug.get(slug);
        accountToClientId.set(ref.accountId, client?.id ?? null);
      }
    }
    for (const [slug, ref] of Object.entries(meta.accountMap)) {
      if (ref) {
        const client = clientsBySlug.get(slug);
        accountToClientId.set(ref.accountId, client?.id ?? null);
      }
    }

    // Fetch precisely the requested current+comparison window. A custom 3-day
    // view asks for 6 days and must not block on a fixed 90-day provider fetch.
    // The next migration introduces real chunks/rollups; until cutover, the
    // legacy cache row is replaced when a wider range is requested.
    const windowFrom = q.from;
    const windowTo = q.to;

    // Windsor: one provider entry per enabled datasource (covers all its
    // accounts in a single call). Meta: one provider entry per mapped ad
    // account (the Marketing API has no "all accounts" insights call).
    const providers: Provider[] = [];
    if (windsor.apiKey && (!q.client || requestedWindsorAccountId)) {
      const enabled = (Object.keys(windsor.datasources) as WindsorDatasource[]).filter((ds) => windsor.datasources[ds]);
      for (const ds of enabled) {
        providers.push({
          datasource: ds,
          accountId: "*", // placeholder — Windsor rows are grouped by account after the fetch, see below
          clientId: null,
          fetch: (from, to) => fetchWindsorPosts(windsor.apiKey, ds, from, to),
        });
      }
    }
    let metaToken: string | null = null;
    if (meta.configured) {
      metaToken = await getMetaAccessToken();
      if (metaToken) {
        for (const [slug, ref] of Object.entries(meta.accountMap)) {
          if (!ref) continue;
          if (q.client && slug !== q.client) continue;
          const client = clientsBySlug.get(slug);
          providers.push({
            datasource: META_ADS_DATASOURCE,
            accountId: ref.accountId,
            clientId: client?.id ?? null,
            fetch: (from, to) => fetchMetaAdsInsights(metaToken as string, ref.accountId, ref.accountName, from, to),
          });
        }
      }
    }

    // A filtered view reads only its mapped cache rows instead of transferring
    // and decoding every account's windowed JSONB payload.
    const cache = await getCachedInsights(accountFilter ?? undefined);
    const now = Date.now();

    // Each provider is an independent network round-trip (Windsor covers a
    // whole datasource per call, Meta is one call per ad account) — run them
    // concurrently so N mapped accounts cost one round-trip's latency, not
    // N of them stacked. A provider with no usable cache that fails still
    // hard-fails the whole request (Promise.all rejects), matching the
    // original sequential behavior.
    async function resolveProvider(provider: Provider): Promise<{ posts: MetaPost[]; oldestFetch: string | null; stale: boolean; staleError?: string }> {
      // Windsor providers are keyed by datasource alone (accountId "*" is a
      // placeholder); Meta providers are keyed by (datasource, accountId).
      const dsRows = provider.accountId === "*"
        ? cache.filter((r) => r.datasource === provider.datasource)
        : cache.filter((r) => r.datasource === provider.datasource && r.account_id === provider.accountId);
      const fresh = dsRows.length > 0 &&
        dsRows.every((r) =>
          now - new Date(r.fetched_at).getTime() < CACHE_TTL_MS &&
          r.date_from <= q.from &&
          r.date_to >= q.to &&
          (provider.datasource !== META_ADS_DATASOURCE || r.payload.every((p) => p.schemaVersion === META_ADS_SCHEMA_VERSION)),
        );

      if (fresh && !q.refresh) {
        const posts: MetaPost[] = [];
        let oldestFetch: string | null = null;
        for (const row of dsRows) {
          posts.push(...row.payload.filter(inRange));
          if (!oldestFetch || row.fetched_at < oldestFetch) oldestFetch = row.fetched_at;
        }
        return { posts, oldestFetch, stale: false };
      }

      try {
        const fetchedAll = await provider.fetch(windowFrom, windowTo);
        const fetched = accountFilter === null
          ? fetchedAll
          : fetchedAll.filter((post) => accountFilter.includes(post.accountId));
        const byAccount = new Map<string, MetaPost[]>();
        for (const p of fetched) {
          const list = byAccount.get(p.accountId);
          if (list) list.push(p); else byAccount.set(p.accountId, [p]);
        }
        await Promise.all(
          Array.from(byAccount.entries()).map(([accountId, accountPosts]) =>
            upsertInsightsCache({
              client_id: provider.clientId ?? accountToClientId.get(accountId) ?? null,
              account_id: accountId,
              datasource: provider.datasource as WindsorDatasource | typeof META_ADS_DATASOURCE,
              date_from: windowFrom,
              date_to: windowTo,
              payload: accountPosts,
            }),
          ),
        );
        return { posts: fetched.filter(inRange), oldestFetch: new Date().toISOString(), stale: false };
      } catch (error) {
        // Degrade to stale cache when we have one; only hard-fail without it.
        if (dsRows.length > 0) {
          const posts: MetaPost[] = [];
          let oldestFetch: string | null = null;
          for (const row of dsRows) {
            posts.push(...row.payload.filter(inRange));
            if (!oldestFetch || row.fetched_at < oldestFetch) oldestFetch = row.fetched_at;
          }
          return { posts, oldestFetch, stale: true, staleError: error instanceof Error ? error.message : "Falha ao atualizar dados." };
        }
        throw error;
      }
    }

    const results = await Promise.all(providers.map(resolveProvider));

    const posts: MetaPost[] = [];
    let oldestFetch: string | null = null;
    let stale = false;
    let staleError: string | undefined;
    for (const r of results) {
      posts.push(...r.posts);
      if (r.oldestFetch && (!oldestFetch || r.oldestFetch < oldestFetch)) oldestFetch = r.oldestFetch;
      if (r.stale) { stale = true; staleError = r.staleError ?? staleError; }
    }

    const filtered = accountFilter === null ? posts : posts.filter((p) => accountFilter.includes(p.accountId));

    return NextResponse.json({
      demo: false,
      stale,
      ...(staleError ? { error: staleError } : {}),
      posts: filtered,
      datasources: { ...windsor.datasources, [META_ADS_DATASOURCE]: Boolean(metaToken) },
      fetchedAt: oldestFetch,
    });
  } catch (error) {
    return apiError(error);
  }
}
