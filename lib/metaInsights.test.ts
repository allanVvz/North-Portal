import { describe, expect, it } from "vitest";
import { normalizeMetaAdRow, normalizeMetaAdsRow, normalizeMetaAdsetRow, normalizePublisherPlatform } from "./metaInsights";

describe("normalizeMetaAdsRow", () => {
  const base = {
    campaign_id: "cmp1",
    campaign_name: "Campanha X",
    date_start: "2026-08-01",
    spend: "45.9",
    reach: "6100",
    clicks: 120,
    unique_clicks: 88,
    inline_link_clicks: 72,
    impressions: 8000,
    frequency: "1.31",
    ctr: "1.5",
    cpc: 0.38,
    cpm: "5.74",
    inline_post_engagement: "41",
    publisher_platform: "instagram",
    objective: "OUTCOME_LEADS",
    account_currency: "BRL",
    actions: [
      { action_type: "link_click", value: "6" },
      { action_type: "post_engagement", value: "41" },
      { action_type: "post_reaction", value: "21" },
      { action_type: "comment", value: "4" },
      { action_type: "post", value: "3" },
      { action_type: "onsite_conversion.post_save", value: "2" },
      { action_type: "video_view", value: "18" },
      { action_type: "lead", value: "5" },
      { action_type: "onsite_conversion.lead_grouped", value: "5" },
      { action_type: "purchase", value: 3 },
      { action_type: "omni_purchase", value: 3 },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: 7 },
    ],
  };

  it("normalizes platform, delivery and paid engagement metrics", () => {
    const p = normalizeMetaAdsRow(base, "act123", "Conta Ads")!;
    expect(p.id).toBe("act123:cmp1:instagram:2026-08-01");
    expect(p.platform).toBe("instagram");
    expect(p.source).toBe("paid");
    expect(p.caption).toBe("Campanha X");
    expect(p.metrics).toMatchObject({
      custo: 45.9,
      alcance: 6100,
      cliques: 120,
      cliquesUnicos: 88,
      cliquesLink: 72,
      impressoes: 8000,
      frequencia: 1.31,
      ctr: 1.5,
      cpc: 0.38,
      cpm: 5.74,
      engajamento: 41,
      likes: 21,
      comentarios: 4,
      compartilhamentos: 3,
      salvos: 2,
      videoViews: 18,
      leads: 5,
      compras: 3,
      mensagens: 7,
      conversoes: 8,
    });
    expect(p.objective).toBe("OUTCOME_LEADS");
    expect(p.currency).toBe("BRL");
    expect(p.schemaVersion).toBe(3);
  });

  it("does not double count aliases or add engagement actions to conversions", () => {
    const p = normalizeMetaAdsRow(base, "act123", "Conta Ads")!;
    expect(p.metrics.conversoes).toBe(8);
    expect(p.metrics.conversoes).toBeLessThan(p.metrics.engajamento!);
  });

  it("falls back to action post_engagement and omits unavailable conversions", () => {
    const { inline_post_engagement: _engagement, ...rest } = base;
    const p = normalizeMetaAdsRow({ ...rest, actions: [{ action_type: "post_engagement", value: 9 }] }, "act123", "Conta Ads")!;
    expect(p.metrics.engajamento).toBe(9);
    expect(p.metrics.conversoes).toBeUndefined();
  });

  it("returns null for rows missing campaign id or a valid date", () => {
    expect(normalizeMetaAdsRow({ ...base, campaign_id: "" }, "act123", "Conta Ads")).toBeNull();
    expect(normalizeMetaAdsRow({ ...base, date_start: "not-a-date" }, "act123", "Conta Ads")).toBeNull();
  });

  it("falls back to campaign id as caption", () => {
    const { campaign_name: _name, ...rest } = base;
    expect(normalizeMetaAdsRow(rest, "act123", "Conta Ads")!.caption).toBe("cmp1");
  });
});

describe("normalizeMetaAdRow", () => {
  const adRow = {
    campaign_id: "cmp1",
    ad_id: "ad1",
    ad_name: "Anúncio Fallback",
    date_start: "2026-08-01",
    spend: "10",
    impressions: 500,
    reach: 400,
    clicks: 5,
    publisher_platform: "facebook",
    account_currency: "BRL",
    actions: [],
  };

  it("uses the creative name/thumbnail when present, id/ad_name as fallback", () => {
    const creatives = new Map([["ad1", { name: "Criativo Real", thumbnailUrl: "https://example.com/x.jpg" }]]);
    const p = normalizeMetaAdRow(adRow, "act1", "Conta", creatives)!;
    expect(p.adId).toBe("ad1");
    expect(p.adName).toBe("Criativo Real");
    expect(p.caption).toBe("Criativo Real");
    expect(p.thumbnailUrl).toBe("https://example.com/x.jpg");
    expect(p.id).toBe("act1:cmp1:ad1:facebook:2026-08-01");
    expect(p.metrics.custo).toBe(10);
  });

  it("falls back to ad_name, then ad_id, when there is no creative metadata", () => {
    const p1 = normalizeMetaAdRow(adRow, "act1", "Conta", new Map())!;
    expect(p1.adName).toBe("Anúncio Fallback");
    const { ad_name: _adName, ...noName } = adRow;
    const p2 = normalizeMetaAdRow(noName, "act1", "Conta", new Map())!;
    expect(p2.adName).toBe("ad1");
  });

  it("returns null when the row has no ad id", () => {
    const { ad_id: _adId, ...rest } = adRow;
    expect(normalizeMetaAdRow(rest, "act1", "Conta", new Map())).toBeNull();
  });
});

describe("normalizeMetaAdsetRow", () => {
  it("preserves the explicit campaign → adset relationship", () => {
    const post = normalizeMetaAdsetRow({
      campaign_id: "cmp1", campaign_name: "Campanha", adset_id: "set1", adset_name: "Público quente",
      date_start: "2026-08-01", spend: "21.50", reach: "900", publisher_platform: "instagram",
    }, "act1", "Conta")!;
    expect(post.campaignId).toBe("cmp1");
    expect(post.campaignName).toBe("Campanha");
    expect(post.adsetId).toBe("set1");
    expect(post.adsetName).toBe("Público quente");
    expect(post.metrics.custo).toBe(21.5);
  });
});

describe("normalizePublisherPlatform", () => {
  it("keeps every paid placement instead of forcing Facebook", () => {
    expect(normalizePublisherPlatform("instagram")).toBe("instagram");
    expect(normalizePublisherPlatform("facebook")).toBe("facebook");
    expect(normalizePublisherPlatform("whatsapp")).toBe("whatsapp");
    expect(normalizePublisherPlatform("something_new")).toBe("unknown");
  });
});
