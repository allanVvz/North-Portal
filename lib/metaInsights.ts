import { GRAPH_VERSION } from "./meta";
import { HttpError } from "./validation";
import type { MetaPlatform, MetaPost } from "./windsor";

// Marketing API client for the direct Meta OAuth connection. Paid insights
// share the same cache shape as Windsor rows, but retain ad-specific fields.

export const META_ADS_DATASOURCE = "meta_ads" as const;
// Ad-level drill-down (one row per ad/creative instead of per campaign),
// fetched on demand when a campaign row is expanded. Shares the campaign
// datasource's schema version — both come from normalizeAdsMetrics below.
export const META_ADS_CREATIVE_DATASOURCE = "meta_ads_creative" as const;
export const META_ADS_ADSET_DATASOURCE = "meta_ads_adset" as const;
export const META_ADS_SCHEMA_VERSION = 5;

function num(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

function str(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

function actionMap(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const record = entry as Record<string, unknown> | null;
    const type = str(record?.action_type);
    const value = num(record?.value);
    if (type && value !== undefined) out.set(type, value);
  }
  return out;
}

function firstAction(actions: Map<string, number>, keys: string[]): number | undefined {
  for (const key of keys) if (actions.has(key)) return actions.get(key);
  return undefined;
}

export function normalizePublisherPlatform(raw: unknown): MetaPlatform {
  switch (str(raw).toLowerCase()) {
    case "instagram": return "instagram";
    case "facebook": return "facebook";
    case "whatsapp": return "whatsapp";
    case "messenger": return "messenger";
    case "audience_network": return "audience_network";
    default: return "unknown";
  }
}

// Shared metric extraction for both campaign-level and ad-level /insights
// rows — the field set and action-type mapping are identical, only the
// grouping level (and therefore the id/caption built around it) differs.
// O desfecho que a campanha realmente persegue, escolhido pelo objetivo.
// Medido no cache de producao (6 contas, 90 dias): campanhas de venda fecham
// mais em compra (230) do que em conversa (203), enquanto engajamento/trafego
// fecham em conversa (1.108 contra 110 compras). Somar os dois tipos contaria
// o mesmo funil duas vezes; contar so conversa subestimaria as campanhas de
// venda. Por isso o desfecho e escolhido, nunca somado.
//
// `leads` entra apenas como ultimo recurso: no mesmo periodo sao 94 eventos
// contra 1.311 de mensagens, e nas 44 linhas em que os dois aparecem juntos
// leads e menor em 38 delas. Ele mede o mesmo evento de negocio pior, entao
// somar seria dupla contagem e prioriza-lo seria subcontagem.
function resultadoFor(
  objective: string,
  messages: number | undefined,
  leads: number | undefined,
  purchases: number | undefined,
): number | undefined {
  const o = objective.toUpperCase();
  const salesFirst = o.includes("SALES") || o.includes("PURCHASE") || o.includes("CONVERSION");
  return salesFirst
    ? purchases ?? messages ?? leads
    : messages ?? leads ?? purchases;
}

function normalizeAdsMetrics(row: Record<string, unknown>): MetaPost["metrics"] {
  const metrics: MetaPost["metrics"] = {};
  const actions = actionMap(row.actions);
  const spend = num(row.spend);
  const reach = num(row.reach);
  const clicks = num(row.clicks);
  const uniqueClicks = num(row.unique_clicks);
  const linkClicks = num(row.inline_link_clicks);
  const impressions = num(row.impressions);
  const frequency = num(row.frequency);
  const ctr = num(row.ctr);
  const cpc = num(row.cpc);
  const cpm = num(row.cpm);
  const engagement = num(row.inline_post_engagement) ?? firstAction(actions, ["post_engagement"]);
  const reactions = firstAction(actions, ["post_reaction", "onsite_conversion.post_net_like"]);
  const comments = firstAction(actions, ["comment", "onsite_conversion.post_net_comment"]);
  const shares = firstAction(actions, ["post"]);
  const saves = firstAction(actions, ["onsite_conversion.post_save", "onsite_conversion.post_net_save"]);
  const videoViews = firstAction(actions, ["video_view"]);
  const landingPageViews = firstAction(actions, ["landing_page_view", "omni_landing_page_view"]);

  // The same business event commonly appears under several aliases. Select
  // one canonical total per category; summing every action creates fake
  // conversions by counting clicks, video views and duplicate aliases.
  const leads = firstAction(actions, [
    "lead", "onsite_conversion.lead_grouped", "onsite_conversion.lead",
    "onsite_web_lead", "offsite_conversion.fb_pixel_lead",
  ]);
  const purchases = firstAction(actions, [
    "purchase", "omni_purchase", "onsite_web_purchase", "onsite_web_app_purchase",
    "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase",
  ]);
  const messages = firstAction(actions, ["onsite_conversion.messaging_conversation_started_7d"]);

  if (spend !== undefined) metrics.custo = spend;
  if (reach !== undefined) metrics.alcance = reach;
  if (clicks !== undefined) metrics.cliques = clicks;
  if (uniqueClicks !== undefined) metrics.cliquesUnicos = uniqueClicks;
  if (linkClicks !== undefined) metrics.cliquesLink = linkClicks;
  if (impressions !== undefined) metrics.impressoes = impressions;
  if (frequency !== undefined) metrics.frequencia = frequency;
  if (ctr !== undefined) metrics.ctr = ctr;
  if (cpc !== undefined) metrics.cpc = cpc;
  if (cpm !== undefined) metrics.cpm = cpm;
  if (engagement !== undefined) metrics.engajamento = engagement;
  if (reactions !== undefined) metrics.likes = reactions;
  if (comments !== undefined) metrics.comentarios = comments;
  if (shares !== undefined) metrics.compartilhamentos = shares;
  if (saves !== undefined) metrics.salvos = saves;
  if (videoViews !== undefined) metrics.videoViews = videoViews;
  if (landingPageViews !== undefined) metrics.landingPageViews = landingPageViews;
  if (leads !== undefined) metrics.leads = leads;
  if (purchases !== undefined) metrics.compras = purchases;
  if (messages !== undefined) metrics.mensagens = messages;
  if (leads !== undefined || purchases !== undefined) metrics.conversoes = (leads ?? 0) + (purchases ?? 0);
  const resultado = resultadoFor(str(row.objective), messages, leads, purchases);
  if (resultado !== undefined) metrics.resultado = resultado;
  // "Alguém levantou a mão", independente do objetivo da campanha. A Meta
  // reporta o mesmo evento ora como `lead`, ora como conversa iniciada: no
  // cache de produção são 94 leads contra 1.311 conversas, e nas 44 linhas em
  // que os dois aparecem juntos leads é menor em 38. Somar contaria duas vezes;
  // escolher só um perderia as contas que só reportam o outro. Por isso `max`,
  // e por linha (campanha x plataforma x dia), onde os dois descrevem o mesmo
  // punhado de pessoas.
  if (messages !== undefined || leads !== undefined) {
    metrics.contatos = Math.max(messages ?? 0, leads ?? 0);
  }
  return metrics;
}

// One /insights row (campaign + publisher platform + day) -> MetaPost.
export function normalizeMetaAdsRow(row: Record<string, unknown>, adAccountId: string, accountName: string): MetaPost | null {
  const date = str(row.date_start).slice(0, 10);
  const campaignId = str(row.campaign_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignId) return null;

  const platform = normalizePublisherPlatform(row.publisher_platform);
  return {
    id: `${adAccountId}:${campaignId}:${platform}:${date}`,
    date,
    accountId: adAccountId,
    accountName,
    platform,
    source: "paid",
    type: "outro",
    caption: str(row.campaign_name) || campaignId,
    permalink: null,
    metrics: normalizeAdsMetrics(row),
    campaignId,
    campaignName: str(row.campaign_name) || campaignId,
    objective: str(row.objective) || undefined,
    currency: str(row.account_currency) || undefined,
    schemaVersion: META_ADS_SCHEMA_VERSION,
  };
}

export type AdCreativeMeta = { name: string; thumbnailUrl: string | null; creativeId?: string | null };

export function normalizeMetaAdsetRow(row: Record<string, unknown>, adAccountId: string, accountName: string): MetaPost | null {
  const date = str(row.date_start).slice(0, 10);
  const campaignId = str(row.campaign_id);
  const adsetId = str(row.adset_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignId || !adsetId) return null;
  const platform = normalizePublisherPlatform(row.publisher_platform);
  const adsetName = str(row.adset_name) || adsetId;
  return {
    id: `${adAccountId}:${campaignId}:${adsetId}:${platform}:${date}`,
    date, accountId: adAccountId, accountName, platform, source: "paid", type: "outro",
    caption: adsetName, permalink: null, metrics: normalizeAdsMetrics(row), campaignId,
    campaignName: str(row.campaign_name) || campaignId, adsetId, adsetName,
    objective: str(row.objective) || undefined,
    optimizationGoal: str(row.optimization_goal) || undefined,
    currency: str(row.account_currency) || undefined,
    schemaVersion: META_ADS_SCHEMA_VERSION,
  };
}

// One /insights row at level="ad" (ad + publisher platform + day) -> MetaPost.
// `creatives` supplies the ad's display name/thumbnail (a separate /ads call —
// insights rows only carry ad_id/ad_name, never creative media).
export function normalizeMetaAdRow(
  row: Record<string, unknown>,
  adAccountId: string,
  accountName: string,
  creatives: Map<string, AdCreativeMeta>,
): MetaPost | null {
  const date = str(row.date_start).slice(0, 10);
  const campaignId = str(row.campaign_id);
  const adId = str(row.ad_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignId || !adId) return null;

  const platform = normalizePublisherPlatform(row.publisher_platform);
  const creative = creatives.get(adId);
  const adName = creative?.name || str(row.ad_name) || adId;
  return {
    id: `${adAccountId}:${campaignId}:${adId}:${platform}:${date}`,
    date,
    accountId: adAccountId,
    accountName,
    platform,
    source: "paid",
    type: "outro",
    caption: adName,
    permalink: null,
    metrics: normalizeAdsMetrics(row),
    campaignId,
    campaignName: str(row.campaign_name) || campaignId,
    adsetId: str(row.adset_id) || undefined,
    adsetName: str(row.adset_name) || undefined,
    adId,
    adName,
    thumbnailUrl: creative?.thumbnailUrl ?? null,
    creativeId: creative?.creativeId ?? undefined,
    objective: str(row.objective) || undefined,
    optimizationGoal: str(row.optimization_goal) || undefined,
    currency: str(row.account_currency) || undefined,
    schemaVersion: META_ADS_SCHEMA_VERSION,
  };
}

const ADS_FIELDS = [
  "campaign_id", "campaign_name", "date_start", "objective", "account_currency",
  "spend", "reach", "impressions", "frequency", "clicks", "unique_clicks",
  "inline_link_clicks", "inline_post_engagement", "ctr", "cpc", "cpm", "actions",
].join(",");

// optimization_goal só existe em nível adset/ad no /insights — não em campanha.
const ADSET_INSIGHTS_FIELDS = ["adset_id", "adset_name", "optimization_goal", ADS_FIELDS].join(",");
const AD_INSIGHTS_FIELDS = ["ad_id", "ad_name", "adset_id", "adset_name", "optimization_goal", ADS_FIELDS].join(",");

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
    breakdowns: "publisher_platform",
    action_breakdowns: "action_type",
    fields: ADS_FIELDS,
    limit: "100",
    access_token: userToken,
  });
  const firstPageUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights?${qs}`;
  const rows = await fetchAllPages(firstPageUrl);
  return rows.map((r) => normalizeMetaAdsRow(r, adAccountId, accountName)).filter((p): p is MetaPost => p !== null);
}

// Ad name + creative thumbnail for every ad in one campaign. Insights rows
// (fetchMetaAdCreativeInsights below) carry ad_id/ad_name but never creative
// media, so this is a separate call against the /ads edge, merged by ad_id.
async function fetchAdCreatives(userToken: string, adAccountId: string, filtering: string): Promise<Map<string, AdCreativeMeta>> {
  const qs = new URLSearchParams({
    fields: "id,name,creative{id,thumbnail_url,image_url}",
    filtering,
    limit: "200",
    access_token: userToken,
  });
  const firstPageUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/ads?${qs}`;
  const rows = await fetchAllPages(firstPageUrl);
  const map = new Map<string, AdCreativeMeta>();
  for (const row of rows) {
    const id = str(row.id);
    if (!id) continue;
    const creative = row.creative as Record<string, unknown> | undefined;
    const thumbnailUrl = creative ? str(creative.thumbnail_url) || str(creative.image_url) || null : null;
    map.set(id, { name: str(row.name) || id, thumbnailUrl, creativeId: creative ? str(creative.id) || null : null });
  }
  return map;
}

export async function fetchMetaAdsetInsights(
  userToken: string,
  adAccountId: string,
  accountName: string,
  campaignId: string,
  dateFrom: string,
  dateTo: string,
): Promise<MetaPost[]> {
  const filtering = JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]);
  const qs = new URLSearchParams({
    level: "adset",
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: "1",
    breakdowns: "publisher_platform",
    action_breakdowns: "action_type",
    fields: ADSET_INSIGHTS_FIELDS,
    filtering,
    limit: "100",
    access_token: userToken,
  });
  const rows = await fetchAllPages(`https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights?${qs}`);
  return rows.map((row) => normalizeMetaAdsetRow(row, adAccountId, accountName)).filter((post): post is MetaPost => post !== null);
}

// Ad-level drill-down for one campaign: daily rows per (ad, publisher
// platform), fetched on demand when a campaign row is expanded — never as
// part of the bulk 90-day campaign fetch.
export async function fetchMetaAdCreativeInsights(
  userToken: string,
  adAccountId: string,
  accountName: string,
  campaignId: string,
  dateFrom: string,
  dateTo: string,
): Promise<MetaPost[]> {
  const filtering = JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]);
  const insightsQs = new URLSearchParams({
    level: "ad",
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: "1",
    breakdowns: "publisher_platform",
    action_breakdowns: "action_type",
    fields: AD_INSIGHTS_FIELDS,
    filtering,
    limit: "100",
    access_token: userToken,
  });
  const insightsUrl = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights?${insightsQs}`;
  const [creatives, rows] = await Promise.all([
    fetchAdCreatives(userToken, adAccountId, filtering),
    fetchAllPages(insightsUrl),
  ]);
  return rows
    .map((r) => normalizeMetaAdRow(r, adAccountId, accountName, creatives))
    .filter((p): p is MetaPost => p !== null);
}
