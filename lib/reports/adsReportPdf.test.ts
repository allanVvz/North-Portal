import { describe, expect, it } from "vitest";
import { renderAdsReportPdf, type AdsReportInput } from "./adsReportPdf";
import { BUILTIN_PERFORMANCE_TEMPLATES, DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";

const period: Period = { from: "2026-08-01", to: "2026-08-30" };
const all = generateDemoPosts(new Date("2026-08-30T12:00:00Z"));

const base: AdsReportInput = {
  clientName: "Cliente Demo",
  period,
  cadenceLabel: "Mensal",
  config: DEFAULT_BUILTIN_TEMPLATE.config,
  generatedAt: new Date("2026-08-31T09:00:00Z"),
  posts: all.filter((p) => p.source === "paid" && inPeriod(p, period)),
  prevPosts: all.filter((p) => p.source === "paid" && inPeriod(p, previousPeriod(period))),
  adPosts: [],
};

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString("latin1") === "%PDF-";

describe("renderAdsReportPdf", () => {
  it("gera um PDF a partir de dados de demo (funil de mensagens)", async () => {
    const buf = await renderAdsReportPdf(base);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });

  it("não lança com posts vazios", async () => {
    const buf = await renderAdsReportPdf({ ...base, posts: [], prevPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("não lança quando o funil é todo null (posts só orgânicos, sem contatos/custo)", async () => {
    const organic = all.filter((p) => p.source === "organic");
    const buf = await renderAdsReportPdf({ ...base, posts: organic, prevPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("período de um dia só (n=1 na evolução) não lança", async () => {
    const oneDay: Period = { from: "2026-08-15", to: "2026-08-15" };
    const buf = await renderAdsReportPdf({
      ...base,
      period: oneDay,
      posts: all.filter((p) => p.source === "paid" && inPeriod(p, oneDay)),
      prevPosts: [],
    });
    expect(isPdf(buf)).toBe(true);
  });

  it("os três builtins renderizam", async () => {
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      const buf = await renderAdsReportPdf({ ...base, config: template.config });
      expect(isPdf(buf), template.id).toBe(true);
    }
  });

  it("template com seções escondidas renderiza (e cabe numa folha)", async () => {
    const cfg: typeof DEFAULT_BUILTIN_TEMPLATE.config = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      acquisition: { ...DEFAULT_BUILTIN_TEMPLATE.config.acquisition, hiddenSections: ["gauges", "volume", "trend"] },
    };
    const buf = await renderAdsReportPdf({ ...base, config: cfg });
    expect(isPdf(buf)).toBe(true);
    // %PDF ... /Type /Page repetido = nº de páginas; com 3 seções aparadas + KPIs
    // + funil + tabela curta, é uma folha só.
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(1);
  });
});
