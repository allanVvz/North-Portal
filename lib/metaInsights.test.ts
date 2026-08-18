import { describe, expect, it } from "vitest";
import { normalizeMetaAdsRow } from "./metaInsights";

describe("normalizeMetaAdsRow", () => {
  const base = {
    campaign_id: "cmp1",
    campaign_name: "Campanha X",
    date_start: "2026-08-01",
    spend: "45.9",
    clicks: 120,
    impressions: 8000,
    ctr: "1.5",
    cpc: 0.38,
    actions: [
      { action_type: "link_click", value: "6" },
      { action_type: "purchase", value: 3 },
    ],
  };

  it("normalizes a campaign-day row, summing actions into conversoes", () => {
    const p = normalizeMetaAdsRow(base, "act123", "Conta Ads")!;
    expect(p).not.toBeNull();
    expect(p.id).toBe("act123:cmp1:2026-08-01");
    expect(p.accountId).toBe("act123");
    expect(p.accountName).toBe("Conta Ads");
    expect(p.platform).toBe("facebook");
    expect(p.source).toBe("paid");
    expect(p.caption).toBe("Campanha X");
    expect(p.metrics.custo).toBeCloseTo(45.9);
    expect(p.metrics.cliques).toBe(120);
    expect(p.metrics.impressoes).toBe(8000);
    expect(p.metrics.ctr).toBeCloseTo(1.5);
    expect(p.metrics.cpc).toBeCloseTo(0.38);
    expect(p.metrics.conversoes).toBe(9);
  });

  it("omits conversoes when actions is absent", () => {
    const { actions: _actions, ...rest } = base;
    void _actions;
    const p = normalizeMetaAdsRow(rest, "act123", "Conta Ads")!;
    expect(p.metrics.conversoes).toBeUndefined();
  });

  it("returns null for rows missing campaign id or a valid date", () => {
    expect(normalizeMetaAdsRow({ ...base, campaign_id: "" }, "act123", "Conta Ads")).toBeNull();
    expect(normalizeMetaAdsRow({ ...base, date_start: "not-a-date" }, "act123", "Conta Ads")).toBeNull();
  });

  it("falls back to campaign id as caption when campaign_name is missing", () => {
    const { campaign_name: _name, ...rest } = base;
    void _name;
    const p = normalizeMetaAdsRow(rest, "act123", "Conta Ads")!;
    expect(p.caption).toBe("cmp1");
  });
});
