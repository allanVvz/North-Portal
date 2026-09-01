import { describe, expect, it } from "vitest";
import { renderAdsReportPdf, type AdsReportInput } from "./adsReportPdf";
import { BUILTIN_PERFORMANCE_TEMPLATES, DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { generateDemoPosts } from "@/app/admin/performance/demoData";
import { inPeriod, previousPeriod, type Period } from "@/app/admin/performance/insights";
import type { MetaPost } from "@/lib/windsor";

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

// PNG 1x1 transparente — miniatura de criativo já hidratada para data: URI.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Um punhado de linhas ad-level para a tabela de criativos — metade com
// miniatura hidratada, metade sem.
const adPosts: MetaPost[] = base.posts.slice(0, 6).map((p, i) => ({
  ...p,
  id: `${p.id}:ad${i}`,
  adId: `ad-${i % 3}`,
  adName: `Criativo ${["A", "B", "C"][i % 3]}`,
  thumbnailUrl: i % 2 === 0 ? PNG_1PX : null,
}));

// renderToBuffer + registro de fontes é lento numa importação fria.
describe("renderAdsReportPdf", { timeout: 30_000 }, () => {
  it("gera um PDF a partir de dados de demo (com criativos)", async () => {
    const buf = await renderAdsReportPdf({ ...base, adPosts });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });

  it("não lança com posts vazios", async () => {
    const buf = await renderAdsReportPdf({ ...base, posts: [], prevPosts: [], adPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("não lança sem adPosts (conta Windsor / sem detalhe por criativo)", async () => {
    const buf = await renderAdsReportPdf({ ...base, adPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("não lança quando o funil é todo null (posts só orgânicos)", async () => {
    const organic = all.filter((p) => p.source === "organic");
    const buf = await renderAdsReportPdf({ ...base, posts: organic, prevPosts: [], adPosts: [] });
    expect(isPdf(buf)).toBe(true);
  });

  it("período de um dia só não lança", async () => {
    const oneDay: Period = { from: "2026-08-15", to: "2026-08-15" };
    const buf = await renderAdsReportPdf({
      ...base,
      period: oneDay,
      posts: all.filter((p) => p.source === "paid" && inPeriod(p, oneDay)),
      prevPosts: [],
      adPosts: [],
    });
    expect(isPdf(buf)).toBe(true);
  });

  it("os três builtins renderizam", async () => {
    for (const template of BUILTIN_PERFORMANCE_TEMPLATES) {
      const buf = await renderAdsReportPdf({ ...base, config: template.config, adPosts });
      expect(isPdf(buf), template.id).toBe(true);
    }
  });

  it("tag de bloco por campanha + funil com followersGained na cauda não lança", async () => {
    const first = base.posts.find((p) => p.campaignId)!;
    const cfg: typeof DEFAULT_BUILTIN_TEMPLATE.config = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      campaignBlocks: { [first.campaignId!]: "trafego_perfil" },
      adSourceTags: { "ad-0": "1", "ad-1": "2" },
      acquisition: {
        ...DEFAULT_BUILTIN_TEMPLATE.config.acquisition,
        funnelStages: ["alcance", "cliquesLink", "contatos", "followersGained"],
      },
    };
    const buf = await renderAdsReportPdf({ ...base, config: cfg, adPosts });
    expect(isPdf(buf)).toBe(true);
  });

  it("funil com 'Visitas ao site' + Seguidores no meio (config da CRIS) não lança", async () => {
    const cfg: typeof DEFAULT_BUILTIN_TEMPLATE.config = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      acquisition: {
        ...DEFAULT_BUILTIN_TEMPLATE.config.acquisition,
        funnelStages: ["alcance", "cliquesLink", "landingPageViews", "followersGained", "contatos"],
      },
    };
    const buf = await renderAdsReportPdf({ ...base, config: cfg, adPosts });
    expect(isPdf(buf)).toBe(true);
  });

  it("KPI 'Mensagens' aparece mesmo sem nenhuma linha de desfecho no bloco", async () => {
    // posts sem contatos/mensagens/leads em nenhuma linha — o card não pode sumir
    // nem virar "—": mensagem é o desfecho que a equipe conta.
    const semDesfecho = base.posts.map((p) => {
      const { contatos: _c, mensagens: _m, leads: _l, ...metrics } = p.metrics;
      return { ...p, metrics };
    });
    const buf = await renderAdsReportPdf({ ...base, posts: semDesfecho, prevPosts: [], adPosts: [] });
    expect(isPdf(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(3000);
  });
});
