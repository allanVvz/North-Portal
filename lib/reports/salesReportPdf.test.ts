import { describe, expect, it } from "vitest";
import { renderSalesReportPdf, type SalesReportInput } from "./salesReportPdf";
import { DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { MetaPost } from "@/lib/windsor";
import type { ConversionRow } from "@/lib/ai/extractMetrics";

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

describe("renderSalesReportPdf", { timeout: 30_000 }, () => {
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

  it("com receita total e seguidores (sem linhas detalhadas) não lança", async () => {
    const buf = await renderSalesReportPdf({ ...base, conversoes: [], receitaTotal: 4200, seguidores: 45 });
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });

  it("sem tag de fonte no template (receita não atribuível a objetivo) não lança", async () => {
    const buf = await renderSalesReportPdf({
      ...base,
      config: { ...DEFAULT_BUILTIN_TEMPLATE.config, adSourceTags: {} },
      conversoes: [],
      receitaTotal: 4200,
      vendasTotal: 3,
    });
    expect(isPdf(buf)).toBe(true);
  });

  // A série de `task_metrics` (period_to) é a fonte preferida do comparativo:
  // o gestor pode ter relatado "5 vendas" na semana passada sem detalhar linha
  // a linha, e aí derivar de `prevConversoes` diria 0 e a variação mentiria.
  it("com prevTotals da série (incl. seguidores) não lança", async () => {
    const buf = await renderSalesReportPdf({
      ...base,
      seguidores: 829,
      prevTotals: { vendas: 5, agendamentos: 9, receita: 6100, seguidores: 812 },
    });
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });

  // O ganho negativo passa pelo outro ramo de cor do cartão de seguidores e
  // tira a etapa do funil — vale um caminho de render próprio.
  it("com perda de seguidores (ganho negativo) não lança", async () => {
    const buf = await renderSalesReportPdf({
      ...base,
      seguidores: 805,
      prevTotals: { vendas: 5, agendamentos: 9, receita: 6100, seguidores: 829, from: "2026-07-25", to: "2026-07-31" },
    });
    expect(isPdf(buf)).toBe(true);
  });

  it("prevTotals com campos nulos (semana anterior sem aquela métrica) não lança", async () => {
    const buf = await renderSalesReportPdf({
      ...base,
      prevTotals: { vendas: null, agendamentos: null, receita: null, seguidores: null },
    });
    expect(isPdf(buf)).toBe(true);
  });

  it("totais relatados (5 vendas / 9 agend.) com só 2 linhas detalhadas não lança", async () => {
    const buf = await renderSalesReportPdf({
      ...base,
      conversoes: conversoes.slice(0, 2),
      vendasTotal: 5,
      agendamentosTotal: 9,
      receitaTotal: 4200,
      seguidores: 35,
    });
    expect(isPdf(buf)).toBe(true);
  });
});
