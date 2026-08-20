import { describe, expect, it } from "vitest";
import type { MetaPost } from "@/lib/windsor";
import { acquisitionDailySeries, creativePerformanceRows, ratio, summarizeAcquisition, totalWhenPresent } from "./acquisitionInsights";

const post = (id: string, date: string, metrics: MetaPost["metrics"], extra: Partial<MetaPost> = {}): MetaPost => ({
  id, date, metrics, accountId: "acc", accountName: "Conta", platform: "facebook", source: "paid", type: "outro",
  caption: id, permalink: null, campaignId: "campaign", ...extra,
});

describe("acquisition insights", () => {
  it("preserves unavailable metrics instead of turning them into zero", () => {
    expect(totalWhenPresent([post("a", "2026-08-01", { custo: 0 })], "custo")).toBe(0);
    expect(totalWhenPresent([post("a", "2026-08-01", { custo: 10 })], "leads")).toBeNull();
    expect(ratio(10, 0)).toBeNull();
  });

  it("computes media and funnel indicators from aggregate volumes", () => {
    const summary = summarizeAcquisition([
      post("a", "2026-08-01", { custo: 100, impressoes: 10000, cliques: 200, leads: 20, mensagens: 40, alcance: 8000 }),
      post("b", "2026-08-02", { custo: 50, impressoes: 5000, cliques: 100, leads: 10, mensagens: 20, alcance: 4000 }),
    ]);
    expect(summary).toMatchObject({ spend: 150, opportunities: 30, costPerLead: 5, cpm: 10, cpc: 0.5, ctr: 2, conversionRate: 10, clickToMessageRate: 20 });
    expect(summary).toMatchObject({ messageClickCount: 300, messageClickBasis: "all" });
  });

  it("prioritizes link clicks for the message bridge and reports the fallback basis", () => {
    const withLinkClicks = summarizeAcquisition([
      post("a", "2026-08-01", { cliques: 100, cliquesLink: 40, mensagens: 10 }),
    ]);
    expect(withLinkClicks).toMatchObject({ messageClickCount: 40, messageClickBasis: "link", clickToMessageRate: 25 });
  });

  it("keeps missing days as null in the temporal series", () => {
    expect(acquisitionDailySeries([post("a", "2026-08-01", { custo: 10, mensagens: 2 })], "2026-08-01", "2026-08-02")).toEqual([
      { date: "2026-08-01", spend: 10, messages: 2 },
      { date: "2026-08-02", spend: null, messages: null },
    ]);
  });

  it("groups creative rows and derives CPA and CTR after summing", () => {
    const rows = creativePerformanceRows([
      post("a", "2026-08-01", { custo: 30, cliques: 30, leads: 3, impressoes: 1000 }, { adId: "ad1", adName: "Criativo A" }),
      post("b", "2026-08-02", { custo: 20, cliques: 20, leads: 2, impressoes: 1000 }, { adId: "ad1", adName: "Criativo A" }),
    ]);
    expect(rows[0]).toMatchObject({ id: "ad1", name: "Criativo A", clicks: 50, leads: 5, cpa: 10, ctr: 2.5 });
  });
});
