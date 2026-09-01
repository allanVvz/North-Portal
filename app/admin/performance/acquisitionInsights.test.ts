import { describe, expect, it } from "vitest";
import type { MetaPost } from "@/lib/windsor";
import {
  acquisitionDailySeries, acquisitionMetricAvailable, acquisitionMetricSeries, creativePerformanceRows,
  ratio, resolveAcquisitionMetric, summarizeAcquisition, totalWhenPresent,
} from "./acquisitionInsights";
import type { CustomMetric } from "@/lib/performancePrefs";

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

  describe("resolveAcquisitionMetric / acquisitionMetricAvailable", () => {
    it("returns null (never 0) when the metric is absent across every post", () => {
      const posts = [post("a", "2026-08-01", { custo: 10 })];
      expect(resolveAcquisitionMetric(posts, "leads", [])).toBeNull();
      expect(acquisitionMetricAvailable(posts, "leads", [])).toBe(false);
    });

    it("resolves a plain built-in metric as a sum", () => {
      const posts = [post("a", "2026-08-01", { leads: 3 }), post("b", "2026-08-02", { leads: 2 })];
      expect(resolveAcquisitionMetric(posts, "leads", [])).toBe(5);
    });

    it("unifica contatos: mensagem iniciada, lead e conversa são um desfecho só (o maior, nunca a soma)", () => {
      // Linha que só reportou `mensagens`, linha que só reportou `leads`.
      const posts = [
        post("a", "2026-08-01", { mensagens: 12 }),
        post("b", "2026-08-02", { leads: 4 }),
      ];
      expect(resolveAcquisitionMetric(posts, "contatos", [])).toBe(12);
      expect(acquisitionMetricAvailable(posts, "contatos", [])).toBe(true);
      // Sem nenhum dos três → null (não 0).
      expect(resolveAcquisitionMetric([post("c", "2026-08-03", { custo: 10 })], "contatos", [])).toBeNull();
    });

    it("resolves ratio built-ins (ctr/cpc/cpm) from summed volume, not per-row averaging", () => {
      const posts = [
        post("a", "2026-08-01", { impressoes: 1000, cliques: 20 }),
        post("b", "2026-08-02", { impressoes: 2000, cliques: 20 }),
      ];
      expect(resolveAcquisitionMetric(posts, "ctr", [])).toBeCloseTo((40 / 3000) * 100, 2);
    });

    it("resolves a custom metric only when both operands are present, else null", () => {
      const custom: CustomMetric[] = [{ id: "cpl", label: "Custo por lead", a: "custo", b: "leads", op: "÷" }];
      const withBoth = [post("a", "2026-08-01", { custo: 100, leads: 10 })];
      expect(resolveAcquisitionMetric(withBoth, "custom:cpl", custom)).toBe(10);
      const missingOperand = [post("a", "2026-08-01", { custo: 100 })];
      expect(resolveAcquisitionMetric(missingOperand, "custom:cpl", custom)).toBeNull();
      expect(acquisitionMetricAvailable(missingOperand, "custom:cpl", custom)).toBe(false);
    });

    it("an unknown custom metric id resolves to null instead of throwing", () => {
      expect(resolveAcquisitionMetric([post("a", "2026-08-01", { custo: 1 })], "custom:missing", [])).toBeNull();
    });
  });

  describe("acquisitionMetricSeries", () => {
    it("zero-fills as null on days with no posts", () => {
      const posts = [post("a", "2026-08-01", { leads: 3 })];
      expect(acquisitionMetricSeries(posts, "leads", "2026-08-01", "2026-08-02", [])).toEqual([
        { date: "2026-08-01", value: 3 },
        { date: "2026-08-02", value: null },
      ]);
    });

    it("derives a ratio metric per day from that day's summed components", () => {
      const posts = [
        post("a", "2026-08-01", { impressoes: 1000, cliques: 20 }),
        post("b", "2026-08-01", { impressoes: 2000, cliques: 20 }),
      ];
      const series = acquisitionMetricSeries(posts, "ctr", "2026-08-01", "2026-08-01", []);
      expect(series[0].value).toBeCloseTo((40 / 3000) * 100, 2);
    });
  });
});
