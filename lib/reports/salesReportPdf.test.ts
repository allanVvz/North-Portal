import { describe, expect, it } from "vitest";
import { renderSalesReportPdf, type SalesReportInput } from "./salesReportPdf";
import { DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { MetaPost } from "@/lib/windsor";
import type { ConversionRow } from "@/lib/ai/extractConversionReport";

const period: Period = { from: "2026-08-01", to: "2026-08-30" };
const all = generateDemoPosts(new Date("2026-08-30T12:00:00Z"));
const paid = all.filter((p) => p.source === "paid");

const adPosts: MetaPost[] = paid.slice(0, 6).map((p, i) => ({
  ...p, id: `${p.id}:ad${i}`, adId: `ad-${i % 3}`, adName: `Criativo ${i}`,
}));

const conversoes: ConversionRow[] = [
  { servico: "Vitrificação", valor: 1200, fonte: "2", status: "fechado" },
  { servico: "Polimento", valor: null, fonte: "1", status: "agendado" },
  { servico: "PPF", valor: 3500, fonte: "2", status: "agendado" },
  { servico: null, valor: null, fonte: null, status: "agendado" },
];

const base: SalesReportInput = {
  clientName: "CRIS CAR CARE",
  period,
  cadenceLabel: "Semanal",
  config: {
    ...DEFAULT_BUILTIN_TEMPLATE.config,
    adSourceTags: { "ad-0": "1", "ad-1": "2", "ad-2": "3" },
  },
  campaignPosts: paid.filter((p) => inPeriod(p, period)),
  prevCampaignPosts: paid.filter((p) => inPeriod(p, previousPeriod(period))),
  adPosts,
  conversoes,
  generatedAt: new Date("2026-08-31T09:00:00Z"),
};

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString("latin1") === "%PDF-";

describe("renderSalesReportPdf", () => {
  it("gera um PDF de vendas com conversões e fontes", async () => {
    const buf = await renderSalesReportPdf(base);
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });

  it("sem conversões não lança (funil trunca em Conversas)", async () => {
    const buf = await renderSalesReportPdf({ ...base, conversoes: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("sem campanhas nem anúncios não lança", async () => {
    const buf = await renderSalesReportPdf({ ...base, campaignPosts: [], prevCampaignPosts: [], adPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("com comparativo do ciclo anterior não lança", async () => {
    const buf = await renderSalesReportPdf({ ...base, prevConversoes: [{ servico: "PPF", valor: 2000, fonte: "1", status: "fechado" }] });
    expect(isPdf(buf)).toBe(true);
  });
});
