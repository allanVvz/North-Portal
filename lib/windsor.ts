import { HttpError } from "./validation";

// Windsor.ai connector client + row normalizer. The fetchers are SERVER ONLY
// (the API key is a query param — it must never reach the browser); the
// normalizer and types are pure and shared with the dashboard/tests.

export type WindsorDatasource = "instagram_organic" | "facebook_organic" | "facebook";

export const WINDSOR_DATASOURCES: { key: WindsorDatasource; label: string }[] = [
  { key: "instagram_organic", label: "Instagram orgânico" },
  { key: "facebook_organic", label: "Facebook orgânico" },
  { key: "facebook", label: "Facebook Ads (pago)" },
];

export type MetaPostType = "imagem" | "video" | "carrossel" | "reel" | "story" | "outro";

export type MetaPostMetricKey =
  | "alcance" | "impressoes" | "likes" | "comentarios" | "compartilhamentos"
  | "salvos" | "engajamento" | "videoViews" | "cliques" | "ctr" | "custo"
  | "cpc" | "cpm" | "frequencia" | "cliquesUnicos" | "cliquesLink"
  | "landingPageViews" | "leads" | "compras" | "mensagens" | "conversoes"
  | "profileVisits" | "followers" | "followersGained" | "resultado" | "contatos";

export type MetaPlatform = "instagram" | "facebook" | "whatsapp" | "messenger" | "audience_network" | "unknown";

export type MetaPost = {
  id: string;
  date: string; // YYYY-MM-DD
  accountId: string;
  accountName: string;
  platform: MetaPlatform;
  source: "organic" | "paid";
  type: MetaPostType;
  caption: string;
  permalink: string | null;
  metrics: Partial<Record<MetaPostMetricKey, number>>;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  objective?: string;
  // Meta `optimization_goal` da campanha (LINK_CLICKS / PROFILE_VISIT /
  // CONVERSATIONS / ...). Só no path Meta direto — melhora a auto-sugestão de
  // bloco (suggestCampaignBlock).
  optimizationGoal?: string;
  currency?: string;
  schemaVersion?: number;
  // Ad-level drill-down only (datasource "meta_ads_creative") — absent on
  // campaign-level rows.
  adId?: string;
  adName?: string;
  creativeId?: string;
  thumbnailUrl?: string | null;
};

export type WindsorAccountRef = { accountId: string; accountName: string };

export type WindsorSettings = {
  apiKey: string; // raw — server only, masked before any GET response
  datasources: Record<WindsorDatasource, boolean>;
  // clientSlug -> Windsor account; null = admin explicitly left it unmapped.
  accountMap: Record<string, WindsorAccountRef | null>;
};

export const WINDSOR_SETTINGS_DEFAULT: WindsorSettings = {
  apiKey: "",
  datasources: { instagram_organic: true, facebook_organic: true, facebook: false },
  accountMap: {},
};

// ---- Normalization (pure) ------------------------------------------------------

// `productType` is the IG Graph API's separate media_product_type field
// (AD/FEED/STORY/REELS) — Windsor sometimes exposes it alongside media_type
// (IMAGE/VIDEO/CAROUSEL_ALBUM) instead of folding stories/reels into it.
// Checked first since it disambiguates a feed video from a Reel/Story that
// Graph API otherwise reports as media_type=VIDEO.
export function normalizeMediaType(raw: unknown, productType?: unknown): MetaPostType {
  const p = String(productType ?? "").toLowerCase();
  if (p.includes("story") || p.includes("stories")) return "story";
  if (p.includes("reel")) return "reel";
  const v = String(raw ?? "").toLowerCase();
  if (!v) return "outro";
  if (v.includes("story") || v.includes("stories")) return "story";
  if (v.includes("reel")) return "reel";
  if (v.includes("carousel") || v.includes("album")) return "carrossel";
  if (v.includes("video")) return "video";
  if (v.includes("image") || v.includes("photo") || v.includes("picture")) return "imagem";
  return "outro";
}

function num(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function str(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

/** ISO date (YYYY-MM-DD) from a Windsor `date` value; null when unparseable. */
function isoDay(raw: unknown): string | null {
  const s = str(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// One Windsor row -> MetaPost (null = malformed/unusable row). Field names
// drift between datasources (caption vs message, media_type vs type,
// post_id vs campaign) — this is the single, unit-tested seam that absorbs it.
export function normalizeWindsorRow(row: Record<string, unknown>, ds: WindsorDatasource): MetaPost | null {
  const date = isoDay(row.date);
  const accountId = str(row.account_id);
  if (!date || !accountId) return null;

  const accountName = str(row.account_name) || accountId;

  if (ds === "facebook") {
    // Paid rows are campaign-level, not post-level.
    const campaign = str(row.campaign);
    if (!campaign) return null;
    const metrics: MetaPost["metrics"] = {};
    const spend = num(row.spend);
    const clicks = num(row.clicks);
    const impressions = num(row.impressions);
    const ctr = num(row.ctr);
    const cpc = num(row.cpc);
    const actions = num(row.actions);
    if (spend !== undefined) metrics.custo = spend;
    if (clicks !== undefined) metrics.cliques = clicks;
    if (impressions !== undefined) metrics.impressoes = impressions;
    if (ctr !== undefined) metrics.ctr = ctr;
    if (cpc !== undefined) metrics.cpc = cpc;
    if (actions !== undefined) metrics.conversoes = actions;
    return {
      id: `${accountId}:${campaign}:${date}`,
      date,
      accountId,
      accountName,
      platform: "facebook",
      source: "paid",
      type: "outro",
      caption: campaign,
      permalink: null,
      metrics,
    };
  }

  const postId = str(row.post_id);
  if (!postId) return null;
  const platform = ds === "instagram_organic" ? "instagram" : "facebook";
  const metrics: MetaPost["metrics"] = {};
  const reach = num(row.reach);
  const impressions = num(row.impressions);
  const likes = num(row.likes);
  const comments = num(row.comments);
  const shares = num(row.shares);
  const saved = num(row.saved);
  const videoViews = num(row.video_views);
  const engagement = num(row.engagement);
  if (reach !== undefined) metrics.alcance = reach;
  if (impressions !== undefined) metrics.impressoes = impressions;
  if (likes !== undefined) metrics.likes = likes;
  if (comments !== undefined) metrics.comentarios = comments;
  if (shares !== undefined) metrics.compartilhamentos = shares;
  if (saved !== undefined) metrics.salvos = saved;
  if (videoViews !== undefined) metrics.videoViews = videoViews;
  // Some accounts return no explicit engagement — derive from interactions.
  metrics.engajamento = engagement !== undefined
    ? engagement
    : (likes ?? 0) + (comments ?? 0) + (shares ?? 0) + (saved ?? 0);

  return {
    id: postId,
    date,
    accountId,
    accountName,
    platform,
    source: "organic",
    type: normalizeMediaType(row.media_type ?? row.type, row.media_product_type),
    caption: str(row.caption ?? row.message),
    permalink: str(row.permalink) || null,
    metrics,
  };
}

// ---- Fetchers (server only) ----------------------------------------------------

const FIELDS: Record<WindsorDatasource, string> = {
  instagram_organic:
    "date,account_id,account_name,post_id,media_type,media_product_type,caption,permalink,impressions,reach,likes,comments,shares,saved,video_views,engagement",
  facebook_organic:
    "date,account_id,account_name,post_id,type,message,permalink,impressions,reach,likes,comments,shares,engagement",
  facebook: "date,account_id,account_name,campaign,spend,clicks,impressions,ctr,cpc,actions",
};

async function windsorGet(apiKey: string, ds: WindsorDatasource, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({ api_key: apiKey, ...params });
  let res: Response;
  try {
    res = await fetch(`https://connectors.windsor.ai/${ds}?${qs}`, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    throw new HttpError(502, "Não foi possível falar com a Windsor.ai — verifique a conexão e tente de novo.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, "Chave da Windsor inválida ou expirada.");
  }
  if (res.status === 429) {
    throw new HttpError(503, "Limite de requisições da Windsor atingido. Tente novamente mais tarde.");
  }
  if (!res.ok) {
    throw new HttpError(502, `A Windsor.ai respondeu com erro (${res.status}).`);
  }
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  return Array.isArray(body?.data) ? (body.data as Record<string, unknown>[]) : [];
}

export async function fetchWindsorPosts(
  apiKey: string,
  ds: WindsorDatasource,
  dateFrom: string,
  dateTo: string,
): Promise<MetaPost[]> {
  const rows = await windsorGet(apiKey, ds, { fields: FIELDS[ds], date_from: dateFrom, date_to: dateTo });
  return rows.map((r) => normalizeWindsorRow(r, ds)).filter((p): p is MetaPost => p !== null);
}

// Doubles as the account lister for the Integrações mapping UI: a cheap
// 7-day fetch of just account fields per enabled datasource.
export async function testWindsorConnection(
  apiKey: string,
  datasources: WindsorDatasource[],
): Promise<{ ok: boolean; accounts: (WindsorAccountRef & { datasource: WindsorDatasource })[]; error?: string }> {
  const accounts: (WindsorAccountRef & { datasource: WindsorDatasource })[] = [];
  const seen = new Set<string>();
  try {
    for (const ds of datasources) {
      const rows = await windsorGet(apiKey, ds, { fields: "account_id,account_name", date_preset: "last_7d" });
      for (const row of rows) {
        const accountId = str(row.account_id);
        if (!accountId) continue;
        const key = `${ds}:${accountId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        accounts.push({ accountId, accountName: str(row.account_name) || accountId, datasource: ds });
      }
    }
    return { ok: true, accounts };
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Falha ao testar a conexão com a Windsor.ai.";
    return { ok: false, accounts: [], error: message };
  }
}
