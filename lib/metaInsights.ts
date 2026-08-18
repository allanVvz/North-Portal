import { GRAPH_VERSION } from "./meta";
import { HttpError } from "./validation";
import type { MetaPost } from "./windsor";

// Marketing API client for the direct Meta OAuth connection (lib/meta.ts) —
// mirrors lib/windsor.ts's fetch+normalize shape so it can drop into the same
// meta_insights_cache / performance pipeline as another provider.

export const META_ADS_DATASOURCE = "meta_ads" as const;

function num(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

function str(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

// `actions` is an array of {action_type, value}, not a scalar — collapse to
// one total, same as normalizeWindsorRow does for the `facebook` datasource's
// already-scalar `actions` field.
function sumActions(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let total = 0;
  let any = false;
  for (const entry of raw) {
    const value = num((entry as Record<string, unknown> | null)?.value);
    if (value !== undefined) { total += value; any = true; }
  }
  return any ? total : undefined;
}

// One /insights row (a campaign on one day) -> MetaPost, or null if malformed.
export function normalizeMetaAdsRow(row: Record<string, unknown>, adAccountId: string, accountName: string): MetaPost | null {
  const date = str(row.date_start).slice(0, 10);
  const campaignId = str(row.campaign_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignId) return null;

  const metrics: MetaPost["metrics"] = {};
  const spend = num(row.spend);
  const clicks = num(row.clicks);
  const impressions = num(row.impressions);
  const ctr = num(row.ctr);
  const cpc = num(row.cpc);
  const conversoes = sumActions(row.actions);
  if (spend !== undefined) metrics.custo = spend;
  if (clicks !== undefined) metrics.cliques = clicks;
  if (impressions !== undefined) metrics.impressoes = impressions;
  if (ctr !== undefined) metrics.ctr = ctr;
  if (cpc !== undefined) metrics.cpc = cpc;
  if (conversoes !== undefined) metrics.conversoes = conversoes;

  return {
    id: `${adAccountId}:${campaignId}:${date}`,
    date,
    accountId: adAccountId,
    accountName,
    platform: "facebook",
    source: "paid",
    type: "outro",
    caption: str(row.campaign_name) || campaignId,
    permalink: null,
    metrics,
  };
}

const ADS_FIELDS = "campaign_id,campaign_name,date_start,spend,impressions,clicks,ctr,cpc,actions";

// time_increment=1 over a 90-day window easily exceeds one page once an
// account has more than a couple of campaigns — the Marketing API paginates
// /insights just like any other edge, so we must follow `paging.next` or
// older rows silently disappear. Capped to guard against a pathological
// cursor loop; 40 pages * 100/page covers years of daily campaign rows.
const MAX_PAGES = 40;

async function fetchAllPages(firstPageUrl: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let nextUrl: string | null = firstPageUrl;
  for (let page = 0; nextUrl && page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(nextUrl, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    } catch {
      throw new HttpError(502, "Nao foi possivel falar com a Meta — verifique a conexao e tente de novo.");
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown; paging?: { next?: string } } | null;
    if (!res.ok) {
      const message = (body as { error?: { message?: string } } | null)?.error?.message;
      throw new HttpError(502, message ? `A Meta respondeu com erro: ${message}` : `A Meta respondeu com erro (${res.status}).`);
    }
    if (Array.isArray(body?.data)) rows.push(...(body.data as Record<string, unknown>[]));
    nextUrl = body?.paging?.next ?? null;
  }
  return rows;
}

export async function fetchMetaAdsInsights(
  userToken: string,
  adAccountId: string,
  accountName: string,
  dateFrom: string,
  dateTo: string,
): Promise<MetaPost[]> {
  const qs = new URLSearchParams({
    level: "campaign",
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: "1",
    fields: ADS_FIELDS,
    access_token: userToken,
  });
  const firstPageUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights?${qs}`;
  const rows = await fetchAllPages(firstPageUrl);
  return rows.map((r) => normalizeMetaAdsRow(r, adAccountId, accountName)).filter((p): p is MetaPost => p !== null);
}
