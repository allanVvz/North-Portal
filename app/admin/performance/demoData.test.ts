import { describe, expect, it } from "vitest";
import { generateDemoPosts } from "./demoData";

describe("generateDemoPosts", () => {
  const fixed = new Date(2026, 6, 12); // deterministic reference date

  it("is deterministic — two calls produce identical data", () => {
    expect(generateDemoPosts(fixed)).toEqual(generateDemoPosts(fixed));
  });

  it("covers the last 90 days with both organic and paid rows", () => {
    const posts = generateDemoPosts(fixed);
    expect(posts.length).toBeGreaterThan(50);
    expect(posts.some((p) => p.source === "organic")).toBe(true);
    expect(posts.some((p) => p.source === "paid")).toBe(true);
    const min = "2026-04-13"; // 90 days before the fixed date
    for (const p of posts) {
      expect(p.date >= min && p.date <= "2026-07-12").toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(p.date)).toBe(true);
    }
  });

  it("keeps organic metrics loosely correlated (engagement = sum of interactions)", () => {
    for (const p of generateDemoPosts(fixed).filter((x) => x.source === "organic")) {
      const m = p.metrics;
      expect(m.engajamento).toBe((m.likes ?? 0) + (m.comentarios ?? 0) + (m.compartilhamentos ?? 0) + (m.salvos ?? 0));
    }
  });
});
