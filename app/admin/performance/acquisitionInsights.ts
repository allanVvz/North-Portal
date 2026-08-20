import type { MetaPost, MetaPostMetricKey } from "@/lib/windsor";

export type NullableMetric = number | null;

export type AcquisitionSummary = {
  spend: NullableMetric;
  opportunities: NullableMetric;
  costPerLead: NullableMetric;
  impressions: NullableMetric;
  clicks: NullableMetric;
  conversionRate: NullableMetric;
  reach: NullableMetric;
  messages: NullableMetric;
  cpm: NullableMetric;
  cpc: NullableMetric;
  ctr: NullableMetric;
  messageClickCount: NullableMetric;
  messageClickBasis: "link" | "all" | null;
  clickToMessageRate: NullableMetric;
};

export type AcquisitionDay = {
  date: string;
  spend: NullableMetric;
  messages: NullableMetric;
};

export type CreativePerformanceRow = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  clicks: NullableMetric;
  leads: NullableMetric;
  cpa: NullableMetric;
  ctr: NullableMetric;
};

export function totalWhenPresent(posts: MetaPost[], key: MetaPostMetricKey): NullableMetric {
  let total = 0;
  let present = false;
  for (const post of posts) {
    const value = post.metrics[key];
    if (value === undefined) continue;
    present = true;
    total += value;
  }
  return present ? total : null;
}

export function ratio(numerator: NullableMetric, denominator: NullableMetric, multiplier = 1): NullableMetric {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * multiplier;
}

export function summarizeAcquisition(posts: MetaPost[]): AcquisitionSummary {
  const spend = totalWhenPresent(posts, "custo");
  const opportunities = totalWhenPresent(posts, "leads");
  const impressions = totalWhenPresent(posts, "impressoes");
  const clicks = totalWhenPresent(posts, "cliques");
  const linkClicks = totalWhenPresent(posts, "cliquesLink");
  const reach = totalWhenPresent(posts, "alcance");
  const messages = totalWhenPresent(posts, "mensagens");
  const messageClickCount = linkClicks !== null ? linkClicks : clicks;
  return {
    spend,
    opportunities,
    costPerLead: ratio(spend, opportunities),
    impressions,
    clicks,
    conversionRate: ratio(opportunities, clicks, 100),
    reach,
    messages,
    cpm: ratio(spend, impressions, 1000),
    cpc: ratio(spend, clicks),
    ctr: ratio(clicks, impressions, 100),
    messageClickCount,
    messageClickBasis: linkClicks !== null ? "link" : clicks !== null ? "all" : null,
    clickToMessageRate: ratio(messages, messageClickCount, 100),
  };
}

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function acquisitionDailySeries(posts: MetaPost[], from: string, to: string): AcquisitionDay[] {
  const days: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(isoDay(cursor));
  }
  return days.map((date) => {
    const rows = posts.filter((post) => post.date === date);
    return { date, spend: totalWhenPresent(rows, "custo"), messages: totalWhenPresent(rows, "mensagens") };
  });
}

export function filterAcquisitionPosts(posts: MetaPost[], campaignId: string, adsetId: string): MetaPost[] {
  return posts.filter((post) =>
    post.source === "paid" &&
    (!campaignId || post.campaignId === campaignId) &&
    (!adsetId || post.adsetId === adsetId),
  );
}

export function creativePerformanceRows(posts: MetaPost[]): CreativePerformanceRow[] {
  const groups = new Map<string, MetaPost[]>();
  for (const post of posts) {
    if (!post.adId) continue;
    const group = groups.get(post.adId);
    if (group) group.push(post);
    else groups.set(post.adId, [post]);
  }
  return Array.from(groups.entries()).map(([id, rows]) => {
    const summary = summarizeAcquisition(rows);
    return {
      id,
      name: rows[0].adName || rows[0].caption || id,
      thumbnailUrl: rows.find((row) => row.thumbnailUrl)?.thumbnailUrl ?? null,
      clicks: summary.clicks,
      leads: summary.opportunities,
      cpa: summary.costPerLead,
      ctr: summary.ctr,
    };
  }).sort((a, b) => (b.leads ?? -1) - (a.leads ?? -1));
}
