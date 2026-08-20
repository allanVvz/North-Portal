import { describe, expect, it } from "vitest";
import { ACQUISITION_VIEW_PREFS_DEFAULT, sanitizeAcquisitionViewPrefs } from "./acquisitionPrefs";
import type { CustomMetric } from "./performancePrefs";

describe("sanitizeAcquisitionViewPrefs", () => {
  it("returns the full default when given nothing", () => {
    expect(sanitizeAcquisitionViewPrefs(undefined)).toEqual(ACQUISITION_VIEW_PREFS_DEFAULT);
    expect(sanitizeAcquisitionViewPrefs(null)).toEqual(ACQUISITION_VIEW_PREFS_DEFAULT);
  });

  it("drops invalid metric keys instead of surfacing a broken slot", () => {
    const result = sanitizeAcquisitionViewPrefs({ gaugeSlots: ["cpm", "not_a_real_metric", "ctr"] });
    expect(result.gaugeSlots).toEqual(["cpm", "ctr"]);
  });

  it("drops a dangling custom-metric reference not present in the supplied customMetrics", () => {
    const result = sanitizeAcquisitionViewPrefs({ kpiSlots: ["custo", "custom:removed"] });
    expect(result.kpiSlots).toEqual(["custo"]);
  });

  it("keeps a custom-metric reference that IS present in the supplied customMetrics", () => {
    const custom: CustomMetric[] = [{ id: "native_cost_per_lead", label: "Custo por lead", a: "custo", b: "leads", op: "÷" }];
    const result = sanitizeAcquisitionViewPrefs({ kpiSlots: ["custo", "custom:native_cost_per_lead"] }, custom);
    expect(result.kpiSlots).toEqual(["custo", "custom:native_cost_per_lead"]);
  });

  it("falls back to the default funnelStages when fewer than 2 valid stages survive", () => {
    const result = sanitizeAcquisitionViewPrefs({ funnelStages: ["bogus"] });
    expect(result.funnelStages).toEqual(ACQUISITION_VIEW_PREFS_DEFAULT.funnelStages);
  });

  it("accepts a 2-stage funnel (e.g. a top-of-funnel template with no leads)", () => {
    const result = sanitizeAcquisitionViewPrefs({ funnelStages: ["alcance", "impressoes"] });
    expect(result.funnelStages).toEqual(["alcance", "impressoes"]);
  });

  it("caps trendMetrics at 2 and drops duplicates", () => {
    const result = sanitizeAcquisitionViewPrefs({ trendMetrics: ["custo", "custo", "mensagens", "leads"] });
    expect(result.trendMetrics).toEqual(["custo", "mensagens"]);
  });

  it("keeps showMessageBranch=false when explicitly set", () => {
    expect(sanitizeAcquisitionViewPrefs({ showMessageBranch: false }).showMessageBranch).toBe(false);
  });
});
