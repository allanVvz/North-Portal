import { describe, expect, it } from "vitest";
import {
  engagementMix, filterPosts, kpiSummary, postToTaskMetrics, previousPeriod, topPosts, trendSeries,
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
