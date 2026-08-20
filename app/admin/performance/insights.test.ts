import { describe, expect, it } from "vitest";
import {
  adSummaries, campaignMetricValue, campaignSummaries, engagementMix, filterPosts, kpiSummaryFromSlots,
  metricRefAvailable, postToTaskMetrics, previousPeriod, resolveMetricValue, sortCampaigns, topCampaigns, topPosts,
  trendSeries,
} from "./insights";
import type { CustomMetric } from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";

function post(overrides: Partial<MetaPost>): MetaPost {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-07-05",
    accountId: "acc",
    accountName: "Conta",
    platform: "instagram",
    source: "organic",
    type: "imagem",
    caption: "",
    permalink: null,
    metrics: {},
    ...overrides,
  };
}

describe("previousPeriod", () => {
  it("returns the immediately preceding window of the same length", () => {
    expect(previousPeriod({ from: "2026-07-08", to: "2026-07-14" })).toEqual({ from: "2026-07-01", to: "2026-07-07" });
    expect(previousPeriod({ from: "2026-07-10", to: "2026-07-10" })).toEqual({ from: "2026-07-09", to: "2026-07-09" });
  });
});

describe("kpiSummaryFromSlots", () => {
  it("totals the period and computes % delta vs previous, only for visible slots", () => {
    const current = [post({ metrics: { alcance: 150 } }), post({ metrics: { alcance: 50 } })];
    const prev = [post({ metrics: { alcance: 100 } })];
    const slots = [{ visible: true, metric: "alcance" as const }, { visible: false, metric: "engajamento" as const }];
    const kpis = kpiSummaryFromSlots(current, prev, slots, []);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]).toMatchObject({ metric: "alcance", value: 200, delta: 100, available: true }); // 100 -> 200 = +100%
  });

  it("delta is null when the previous period has no data (no fake +100%)", () => {
    const kpis = kpiSummaryFromSlots([post({ metrics: { alcance: 10 } })], [], [{ visible: true, metric: "alcance" }], []);
    expect(kpis[0].delta).toBeNull();
  });

  it("resolves a custom-metric slot through the same path as a built-in one", () => {
    const custom: CustomMetric[] = [{ id: "cpc2", label: "Custo por clique", a: "custo", b: "cliques", op: "÷" }];
    const posts = [post({ metrics: { custo: 100, cliques: 20 } })];
    const kpis = kpiSummaryFromSlots(posts, [], [{ visible: true, metric: "custom:cpc2" }], custom);
    expect(kpis[0]).toMatchObject({ label: "Custo por clique", value: 5, available: true });
  });
});

describe("resolveMetricValue / métricas customizadas", () => {
  const custom: CustomMetric[] = [{ id: "c1", label: "Custo por clique", a: "custo", b: "cliques", op: "÷" }];
  const posts = [post({ metrics: { custo: 100, cliques: 25 } })];

  it("applies each of the 4 basic operators", () => {
    const p = [post({ metrics: { alcance: 10, cliques: 4 } })];
    expect(resolveMetricValue(p, "custom:add", [{ id: "add", label: "L", a: "alcance", b: "cliques", op: "+" }])).toBe(14);
    expect(resolveMetricValue(p, "custom:sub", [{ id: "sub", label: "L", a: "alcance", b: "cliques", op: "-" }])).toBe(6);
    expect(resolveMetricValue(p, "custom:mul", [{ id: "mul", label: "L", a: "alcance", b: "cliques", op: "×" }])).toBe(40);
    expect(resolveMetricValue(p, "custom:div", [{ id: "div", label: "L", a: "alcance", b: "cliques", op: "÷" }])).toBe(2.5);
  });

  it("divide-by-zero resolves to 0, not Infinity/NaN", () => {
    const p = [post({ metrics: { alcance: 10, cliques: 0 } })];
    expect(resolveMetricValue(p, "custom:div0", [{ id: "div0", label: "L", a: "alcance", b: "cliques", op: "÷" }])).toBe(0);
  });

  it("falls back to a built-in metric for a plain MetricRef", () => {
    expect(resolveMetricValue(posts, "custo", custom)).toBe(100);
  });

  it("metricRefAvailable requires BOTH operands to have data", () => {
    expect(metricRefAvailable(posts, "custom:c1", custom)).toBe(true);
    expect(metricRefAvailable([post({ metrics: { custo: 100 } })], "custom:c1", custom)).toBe(false);
  });

  it("an unknown custom metric id resolves to 0 instead of throwing", () => {
    expect(resolveMetricValue(posts, "custom:missing", [])).toBe(0);
  });
});

describe("campaignMetricValue", () => {
  it("resolves a custom metric from an already-aggregated row's summed totals", () => {
    const row = { metrics: { custo: 200, cliques: 50 } };
    const custom: CustomMetric[] = [{ id: "cpc", label: "CPC", a: "custo", b: "cliques", op: "÷" }];
    expect(campaignMetricValue(row, "custom:cpc", custom)).toBe(4);
    expect(campaignMetricValue(row, "custo", custom)).toBe(200);
  });
});

describe("trendSeries", () => {
  it("zero-fills days without posts", () => {
    const posts = [post({ date: "2026-07-01", metrics: { alcance: 5 } }), post({ date: "2026-07-03", metrics: { alcance: 7 } })];
    const series = trendSeries(posts, "alcance", { from: "2026-07-01", to: "2026-07-03" });
    expect(series).toEqual([
      { date: "2026-07-01", value: 5 },
      { date: "2026-07-02", value: 0 },
      { date: "2026-07-03", value: 7 },
    ]);
  });

  it("sums same-day posts", () => {
    const posts = [post({ date: "2026-07-01", metrics: { alcance: 5 } }), post({ date: "2026-07-01", metrics: { alcance: 3 } })];
    expect(trendSeries(posts, "alcance", { from: "2026-07-01", to: "2026-07-01" })[0].value).toBe(8);
  });

  it("recomputes ratio metrics from summed daily volume instead of summing the ratio itself", () => {
    // 2 campaigns same day: 1000 impressoes/20 cliques (ctr 2%) and 2000
    // impressoes/20 cliques (ctr 1%) — naively summing ctr would wrongly
    // read 3%; the real daily ctr is 40/3000 ≈ 1.33%.
    const posts = [
      post({ date: "2026-07-01", metrics: { impressoes: 1000, cliques: 20, ctr: 2 } }),
      post({ date: "2026-07-01", metrics: { impressoes: 2000, cliques: 20, ctr: 1 } }),
    ];
    const series = trendSeries(posts, "ctr", { from: "2026-07-01", to: "2026-07-01" });
    expect(series[0].value).toBeCloseTo(1.33, 2);
  });

  it("recomputes cpc/cpm/frequencia the same way", () => {
    const posts = [
      post({ date: "2026-07-01", metrics: { custo: 100, cliques: 20, impressoes: 1000, alcance: 500 } }),
      post({ date: "2026-07-01", metrics: { custo: 50, cliques: 5, impressoes: 500, alcance: 250 } }),
    ];
    const series = { from: "2026-07-01", to: "2026-07-01" };
    expect(trendSeries(posts, "cpc", series)[0].value).toBeCloseTo(150 / 25, 2);
    expect(trendSeries(posts, "cpm", series)[0].value).toBeCloseTo((150 / 1500) * 1000, 2);
    expect(trendSeries(posts, "frequencia", series)[0].value).toBeCloseTo(1500 / 750, 2);
  });

  it("a ratio metric on a day with zero denominator yields 0, not NaN/Infinity", () => {
    const posts = [post({ date: "2026-07-01", metrics: { custo: 100, cliques: 0, impressoes: 0 } })];
    const series = trendSeries(posts, "ctr", { from: "2026-07-01", to: "2026-07-01" });
    expect(series[0].value).toBe(0);
    expect(Number.isFinite(series[0].value)).toBe(true);
  });
});

describe("topPosts", () => {
  const posts = [
    post({ id: "a", metrics: { engajamento: 10 } }),
    post({ id: "b", metrics: { engajamento: 30 } }),
    post({ id: "c", metrics: { engajamento: 20 } }),
    post({ id: "paid", source: "paid", metrics: { engajamento: 999 } }),
  ];

  it("ranks organic posts only, both directions", () => {
    expect(topPosts(posts, "engajamento", 2, "top").map((p) => p.id)).toEqual(["b", "c"]);
    expect(topPosts(posts, "engajamento", 2, "bottom").map((p) => p.id)).toEqual(["a", "c"]);
  });
});

describe("campaignSummaries / topCampaigns", () => {
  const acc = "act123";
  const posts = [
    post({ id: `${acc}:cmp1:instagram:2026-07-01`, campaignId: "cmp1", source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha A", metrics: { alcance: 800, impressoes: 1000, cliques: 20, engajamento: 30, likes: 12, comentarios: 2, custo: 50 } }),
    post({ id: `${acc}:cmp1:instagram:2026-07-02`, campaignId: "cmp1", source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha A", metrics: { alcance: 1500, impressoes: 2000, cliques: 30, engajamento: 50, likes: 20, comentarios: 3, custo: 70 } }),
    post({ id: `${acc}:cmp1:facebook:2026-07-02`, campaignId: "cmp1", source: "paid", platform: "facebook", accountId: acc, accountName: "Conta Ads", caption: "Campanha A", metrics: { alcance: 300, impressoes: 500, cliques: 8, engajamento: 10, likes: 4, comentarios: 1, custo: 20 } }),
    post({ id: `${acc}:cmp2:2026-07-01`, source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha B", metrics: { impressoes: 500, cliques: 5, custo: 200 } }),
    post({ id: "org1", source: "organic", metrics: { alcance: 999 } }),
  ];

  it("groups paid rows by campaign (id sans trailing date), ignoring organic", () => {
    const rows = campaignSummaries(posts);
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => r.caption === "Campanha A" && r.platform === "instagram")!;
    expect(a.metrics.impressoes).toBe(3000);
    expect(a.metrics.cliques).toBe(50);
    expect(a.metrics.custo).toBe(120);
    expect(a.metrics.engajamento).toBe(80);
    expect(a.metrics.likes).toBe(32);
    expect(a.metrics.comentarios).toBe(5);
  });

  it("keeps Instagram and Facebook delivery separated for the same campaign", () => {
    const campaign = campaignSummaries(posts).filter((r) => r.caption === "Campanha A");
    expect(campaign.map((r) => r.platform).sort()).toEqual(["facebook", "instagram"]);
  });

  it("recomputes ctr/cpc from the summed totals, not an average of per-day ratios", () => {
    const a = campaignSummaries(posts).find((r) => r.caption === "Campanha A" && r.platform === "instagram")!;
    expect(a.metrics.ctr).toBeCloseTo((50 / 3000) * 100, 2);
    expect(a.metrics.cpc).toBeCloseTo(120 / 50, 2);
  });

  it("topCampaigns ranks by the given metric, real ads are visible even when no organic post exists", () => {
    const top = topCampaigns(posts, "custo", 1);
    expect(top).toHaveLength(1);
    expect(top[0].caption).toBe("Campanha B");
    expect(top[0].metrics.custo).toBe(200);
  });
});

describe("sortCampaigns", () => {
  const rows = campaignSummaries([
    post({ id: "a:cmp1:facebook:2026-07-01", campaignId: "cmp1", source: "paid", accountId: "a", caption: "Baixo custo", metrics: { custo: 10, alcance: 500 } }),
    post({ id: "a:cmp2:facebook:2026-07-01", campaignId: "cmp2", source: "paid", accountId: "a", caption: "Alto custo", metrics: { custo: 90, alcance: 100 } }),
  ]);

  it("sorts descending by default and ascending when toggled", () => {
    expect(sortCampaigns(rows, "custo", "desc").map((r) => r.caption)).toEqual(["Alto custo", "Baixo custo"]);
    expect(sortCampaigns(rows, "custo", "asc").map((r) => r.caption)).toEqual(["Baixo custo", "Alto custo"]);
  });

  it("treats a missing metric as zero instead of throwing", () => {
    expect(sortCampaigns(rows, "leads", "desc")).toHaveLength(2);
  });
});

describe("adSummaries", () => {
  const acc = "act123";
  const posts: MetaPost[] = [
    post({
      id: `${acc}:cmp1:ad1:instagram:2026-07-01`, campaignId: "cmp1", adId: "ad1", adName: "Criativo A",
      thumbnailUrl: "https://example.com/a.jpg", source: "paid", accountId: acc, accountName: "Conta Ads",
      metrics: { alcance: 400, impressoes: 600, cliques: 10, custo: 20 },
    }),
    post({
      id: `${acc}:cmp1:ad1:instagram:2026-07-02`, campaignId: "cmp1", adId: "ad1", adName: "Criativo A",
      thumbnailUrl: "https://example.com/a.jpg", source: "paid", accountId: acc, accountName: "Conta Ads",
      metrics: { alcance: 600, impressoes: 900, cliques: 15, custo: 30 },
    }),
    post({
      id: `${acc}:cmp1:ad2:instagram:2026-07-01`, campaignId: "cmp1", adId: "ad2", adName: "Criativo B",
      source: "paid", accountId: acc, accountName: "Conta Ads",
      metrics: { alcance: 100, impressoes: 200, cliques: 2, custo: 100 },
    }),
    post({ id: "org1", source: "organic", metrics: { alcance: 999 } }),
  ];

  it("groups by ad (not campaign), summing volume metrics across days", () => {
    const rows = adSummaries(posts);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.adId === "ad1")!;
    expect(a.metrics.alcance).toBe(1000);
    expect(a.metrics.custo).toBe(50);
    expect(a.thumbnailUrl).toBe("https://example.com/a.jpg");
  });

  it("sorts by spend descending", () => {
    expect(adSummaries(posts).map((r) => r.adId)).toEqual(["ad2", "ad1"]);
  });

  it("ignores rows without an adId (campaign-level rows) and organic posts", () => {
    expect(adSummaries([post({ source: "paid", campaignId: "cmp1", metrics: { custo: 1 } }), ...posts])).toHaveLength(2);
  });
});

describe("engagementMix", () => {
  it("aggregates interaction kinds and drops zero slices", () => {
    const posts = [post({ metrics: { likes: 10, comentarios: 2 } }), post({ metrics: { likes: 5, salvos: 1 } })];
    const mix = engagementMix(posts);
    expect(mix.find((s) => s.key === "likes")!.value).toBe(15);
    expect(mix.find((s) => s.key === "comentarios")!.value).toBe(2);
    expect(mix.some((s) => s.key === "compartilhamentos")).toBe(false); // zero -> dropped
  });
});

describe("filterPosts", () => {
  it("filters by platform/type/account, AND-combined", () => {
    const posts = [
      post({ id: "1", platform: "instagram", type: "reel" }),
      post({ id: "2", platform: "facebook", type: "reel" }),
      post({ id: "3", platform: "instagram", type: "imagem" }),
    ];
    expect(filterPosts(posts, { platform: "instagram", type: "reel" }).map((p) => p.id)).toEqual(["1"]);
    expect(filterPosts(posts, {})).toHaveLength(3);
  });
});

describe("postToTaskMetrics", () => {
  it("maps to METRIC_DEFS keys and never emits agendamentos", () => {
    const mapped = postToTaskMetrics(post({ metrics: { alcance: 100, impressoes: 200, engajamento: 30, ctr: 1.5 } }));
    expect(mapped).toEqual({ alcance: "100", impressoes: "200", engajamento: "30", ctr: "1.5" });
    expect(Object.keys(mapped)).not.toContain("agendamentos");
  });

  it("omits metrics the post doesn't carry (never overwrites with empty)", () => {
    expect(postToTaskMetrics(post({ metrics: { alcance: 5 } }))).toEqual({ alcance: "5" });
  });
});
