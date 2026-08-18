import { describe, expect, it } from "vitest";
import {
  campaignSummaries, engagementMix, filterPosts, kpiSummary, postToTaskMetrics, previousPeriod,
  topCampaigns, topPosts, trendSeries,
} from "./insights";
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

describe("kpiSummary", () => {
  it("totals the period and computes % delta vs previous", () => {
    const current = [post({ metrics: { alcance: 150 } }), post({ metrics: { alcance: 50 } })];
    const prev = [post({ metrics: { alcance: 100 } })];
    const kpis = kpiSummary(current, prev, false);
    const alcance = kpis.find((k) => k.key === "alcance")!;
    expect(alcance.value).toBe(200);
    expect(alcance.delta).toBe(100); // 100 -> 200 = +100%
  });

  it("delta is null when the previous period has no data (no fake +100%)", () => {
    const kpis = kpiSummary([post({ metrics: { alcance: 10 } })], [], false);
    expect(kpis.find((k) => k.key === "alcance")!.delta).toBeNull();
  });

  it("swaps the 4th KPI: custo when paid, videoViews otherwise", () => {
    expect(kpiSummary([], [], true).map((k) => k.key)).toContain("custo");
    expect(kpiSummary([], [], false).map((k) => k.key)).toContain("videoViews");
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
    post({ id: `${acc}:cmp1:2026-07-01`, source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha A", metrics: { impressoes: 1000, cliques: 20, custo: 50 } }),
    post({ id: `${acc}:cmp1:2026-07-02`, source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha A", metrics: { impressoes: 2000, cliques: 30, custo: 70 } }),
    post({ id: `${acc}:cmp2:2026-07-01`, source: "paid", accountId: acc, accountName: "Conta Ads", caption: "Campanha B", metrics: { impressoes: 500, cliques: 5, custo: 200 } }),
    post({ id: "org1", source: "organic", metrics: { alcance: 999 } }),
  ];

  it("groups paid rows by campaign (id sans trailing date), ignoring organic", () => {
    const rows = campaignSummaries(posts);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.caption === "Campanha A")!;
    expect(a.metrics.impressoes).toBe(3000);
    expect(a.metrics.cliques).toBe(50);
    expect(a.metrics.custo).toBe(120);
  });

  it("recomputes ctr/cpc from the summed totals, not an average of per-day ratios", () => {
    const a = campaignSummaries(posts).find((r) => r.caption === "Campanha A")!;
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
