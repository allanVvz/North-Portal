import { describe, expect, it } from "vitest";
import { CAMPAIGN_METRIC_COLUMNS, PERFORMANCE_VIEW_PREFS_DEFAULT, sanitizePerformanceViewPrefs } from "./performancePrefs";

describe("sanitizePerformanceViewPrefs", () => {
  it("returns the full default when given nothing", () => {
    expect(sanitizePerformanceViewPrefs(undefined)).toEqual(PERFORMANCE_VIEW_PREFS_DEFAULT);
    expect(sanitizePerformanceViewPrefs(null)).toEqual(PERFORMANCE_VIEW_PREFS_DEFAULT);
  });

  it("drops unknown/removed metric keys instead of surfacing a broken column", () => {
    const result = sanitizePerformanceViewPrefs({ visibleColumns: ["custo", "not_a_real_metric", "leads"] });
    expect(result.visibleColumns).toEqual(["custo", "leads"]);
  });

  it("falls back to the full default set when every visible column was invalid", () => {
    const result = sanitizePerformanceViewPrefs({ visibleColumns: ["bogus"] });
    expect(result.visibleColumns).toEqual(CAMPAIGN_METRIC_COLUMNS.map((c) => c.key));
  });

  it("rejects an invalid sortKey/defaultPeriod, falling back to defaults", () => {
    const result = sanitizePerformanceViewPrefs({ sortKey: "not_real", defaultPeriod: 45 });
    expect(result.sortKey).toBe(PERFORMANCE_VIEW_PREFS_DEFAULT.sortKey);
    expect(result.defaultPeriod).toBe(PERFORMANCE_VIEW_PREFS_DEFAULT.defaultPeriod);
  });

  it("keeps valid overrides", () => {
    const result = sanitizePerformanceViewPrefs({ sortKey: "leads", sortDir: "asc", defaultPeriod: 7 });
    expect(result).toMatchObject({ sortKey: "leads", sortDir: "asc", defaultPeriod: 7 });
  });

  it("treats any non-'asc' sortDir as desc", () => {
    expect(sanitizePerformanceViewPrefs({ sortDir: "sideways" }).sortDir).toBe("desc");
  });
});
