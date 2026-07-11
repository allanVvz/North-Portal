import { describe, expect, it } from "vitest";
import { normalizeMediaType, normalizeWindsorRow } from "./windsor";

describe("normalizeMediaType", () => {
  it("maps Windsor media types to the internal vocabulary", () => {
    expect(normalizeMediaType("REELS")).toBe("reel");
    expect(normalizeMediaType("CAROUSEL_ALBUM")).toBe("carrossel");
    expect(normalizeMediaType("album")).toBe("carrossel");
    expect(normalizeMediaType("VIDEO")).toBe("video");
    expect(normalizeMediaType("IMAGE")).toBe("imagem");
    expect(normalizeMediaType("photo")).toBe("imagem");
    expect(normalizeMediaType("")).toBe("outro");
    expect(normalizeMediaType(undefined)).toBe("outro");
    expect(normalizeMediaType("status")).toBe("outro");
  });
});

describe("normalizeWindsorRow · instagram_organic", () => {
  const base = {
    date: "2026-07-01",
    account_id: "acc1",
    account_name: "Conta IG",
    post_id: "post1",
    media_type: "REELS",
    caption: "Legenda do post",
    permalink: "https://instagram.com/p/x",
    impressions: "1200",
    reach: 1000,
    likes: 50,
    comments: 5,
    shares: 2,
    saved: 8,
    video_views: 700,
    engagement: 65,
  };

  it("normalizes a full row, coercing numeric strings", () => {
    const p = normalizeWindsorRow(base, "instagram_organic")!;
    expect(p).not.toBeNull();
    expect(p.platform).toBe("instagram");
    expect(p.source).toBe("organic");
    expect(p.type).toBe("reel");
    expect(p.caption).toBe("Legenda do post");
    expect(p.metrics.impressoes).toBe(1200); // "1200" string coerced
    expect(p.metrics.alcance).toBe(1000);
    expect(p.metrics.engajamento).toBe(65);
    expect(p.metrics.videoViews).toBe(700);
  });

  it("derives engagement from interactions when Windsor omits it", () => {
    const { engagement: _e, ...rest } = base;
    void _e;
    const p = normalizeWindsorRow(rest, "instagram_organic")!;
    expect(p.metrics.engajamento).toBe(50 + 5 + 2 + 8);
  });

  it("returns null for rows missing date, account or post id", () => {
    expect(normalizeWindsorRow({ ...base, date: undefined }, "instagram_organic")).toBeNull();
    expect(normalizeWindsorRow({ ...base, account_id: "" }, "instagram_organic")).toBeNull();
    expect(normalizeWindsorRow({ ...base, post_id: "" }, "instagram_organic")).toBeNull();
    expect(normalizeWindsorRow({ ...base, date: "not-a-date" }, "instagram_organic")).toBeNull();
  });
});

describe("normalizeWindsorRow · facebook_organic aliases", () => {
  it("accepts message/type instead of caption/media_type", () => {
    const p = normalizeWindsorRow(
      { date: "2026-07-02", account_id: "fb1", post_id: "p2", message: "Post do FB", type: "video", reach: 300 },
      "facebook_organic",
    )!;
    expect(p.platform).toBe("facebook");
    expect(p.caption).toBe("Post do FB");
    expect(p.type).toBe("video");
    expect(p.metrics.alcance).toBe(300);
  });
});

describe("normalizeWindsorRow · facebook (paid)", () => {
  it("normalizes campaign rows as paid with cost metrics", () => {
    const p = normalizeWindsorRow(
      { date: "2026-07-03", account_id: "ads1", account_name: "Ads", campaign: "Campanha X", spend: "45.9", clicks: 120, impressions: 8000, ctr: "1.5", cpc: 0.38, actions: 9 },
      "facebook",
    )!;
    expect(p.source).toBe("paid");
    expect(p.caption).toBe("Campanha X");
    expect(p.metrics.custo).toBeCloseTo(45.9);
    expect(p.metrics.cliques).toBe(120);
    expect(p.metrics.conversoes).toBe(9);
  });

  it("returns null for paid rows without a campaign", () => {
    expect(normalizeWindsorRow({ date: "2026-07-03", account_id: "ads1", spend: 10 }, "facebook")).toBeNull();
  });
});
