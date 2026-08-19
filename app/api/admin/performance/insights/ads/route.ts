import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getCachedAdCreativeInsights, getMetaAccessToken, getMetaSettings, upsertInsightsCache } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, performanceAdInsightsQuerySchema } from "@/lib/validation";
import { fetchMetaAdCreativeInsights, META_ADS_CREATIVE_DATASOURCE, META_ADS_SCHEMA_VERSION } from "@/lib/metaInsights";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h; ?refresh=1 bypasses

// GET /api/admin/performance/insights/ads?account&campaign&from&to[&refresh=1]
// Ad-level drill-down for one campaign, fetched only when a "Campanhas" row
// is expanded (never as part of the bulk campaign fetch). Same cache/degrade
// contract as the campaign-level route, keyed by (accountId:campaignId,
// "meta_ads_creative") instead of by datasource alone.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const q = performanceAdInsightsQuerySchema.parse(Object.fromEntries(url.searchParams));

    const meta = await getMetaSettings();
    const accountRef = Object.values(meta.accountMap).find((ref) => ref?.accountId === q.account);
    if (!meta.configured || !accountRef) {
      // No live Meta connection for this account — nothing to drill into
      // (demo mode has no per-ad breakdown; the campaign row simply won't expand usefully).
      return NextResponse.json({ demo: true, stale: false, ads: [] });
    }
    const token = await getMetaAccessToken();
    if (!token) return NextResponse.json({ demo: true, stale: false, ads: [] });

    const cached = await getCachedAdCreativeInsights(q.account, q.campaign);
    const now = Date.now();
    const fresh = Boolean(
      cached &&
        now - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS &&
        cached.date_from <= q.from &&
        cached.date_to >= q.to &&
        cached.payload.every((p) => p.schemaVersion === META_ADS_SCHEMA_VERSION),
    );

    if (fresh && !q.refresh) {
      return NextResponse.json({
        demo: false,
        stale: false,
        ads: cached!.payload.filter((p) => p.date >= q.from && p.date <= q.to),
      });
    }

    try {
      const rows = await fetchMetaAdCreativeInsights(token, q.account, accountRef.accountName, q.campaign, q.from, q.to);
      await upsertInsightsCache({
        client_id: null,
        account_id: `${q.account}:${q.campaign}`,
        datasource: META_ADS_CREATIVE_DATASOURCE,
        date_from: q.from,
        date_to: q.to,
        payload: rows,
      });
      return NextResponse.json({ demo: false, stale: false, ads: rows });
    } catch (error) {
      if (cached) {
        return NextResponse.json({
          demo: false,
          stale: true,
          error: error instanceof Error ? error.message : "Falha ao atualizar dados.",
          ads: cached.payload.filter((p) => p.date >= q.from && p.date <= q.to),
        });
      }
      throw error instanceof HttpError ? error : new HttpError(502, "Nao foi possivel buscar os anuncios da campanha.");
    }
  } catch (error) {
    return apiError(error);
  }
}
