import { describe, expect, it } from "vitest";
import { CAMPAIGN_BLOCK_LABEL, DEFAULT_BUILTIN_TEMPLATE, type CampaignBlock, type PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { MetaPost } from "@/lib/windsor";
import { BUILTIN_PERFORMANCE_TEMPLATES } from "@/lib/performanceTemplates";
import { BLOCK_KPIS_DEFAULT, blockKpisOf, blockResolver, CampaignBlocksSection, kpiForDef, showsDelta } from "./campaignBlockKpis";

const templateById = (id: string) => BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === id)!;

const config = (campaignBlocks: Record<string, CampaignBlock> = {}): PerformanceTemplateConfig => ({
  ...DEFAULT_BUILTIN_TEMPLATE.config,
  campaignBlocks,
});

const ad = (over: Partial<MetaPost> = {}): MetaPost => ({
  id: over.id ?? "ad-1",
  date: "2026-09-15",
  accountId: "account-1",
  accountName: "Conta",
  platform: "instagram",
  source: "paid",
  type: "imagem",
  caption: "Criativo",
  permalink: null,
  metrics: {},
  campaignId: "campaign-1",
  campaignName: "Campanha",
  ...over,
});

describe("blockResolver", () => {
  it("configuração manual vence todas as evidências, inclusive quando salva pelo nome", () => {
    const ads = [ad({ optimizationGoal: "PROFILE_VISIT" })];
    const { blockOf } = blockResolver(config({ Campanha: "mensagens" }), ads);

    expect(blockOf("campaign-1", "Campanha", "LINK_CLICKS", "LANDING_PAGE_VIEWS")).toBe("mensagens");
  });

  it.each(["PROFILE_VISIT", "PROFILE_VISITS", "PAGE_PROFILE", "INSTAGRAM_PROFILE_VISITS"])(
    "%s no anúncio vence LINK_CLICKS da campanha",
    (optimizationGoal) => {
      const { blockOf } = blockResolver(config(), [ad({ optimizationGoal })]);

      expect(blockOf("campaign-1", "Aquisição site", "LINK_CLICKS", "LINK_CLICKS")).toBe("trafego_perfil");
    },
  );

  it("segue goal da linha, objective e nome somente quando a evidência anterior é inconclusiva", () => {
    const unknownAd = ad({ optimizationGoal: "NONE" });
    const { blockOf } = blockResolver(config(), [unknownAd]);

    expect(blockOf("campaign-1", "Perfil", "PROFILE_VISIT", "CONVERSATIONS")).toBe("mensagens");
    expect(blockOf("campaign-2", "Nome neutro", "LANDING_PAGE_VIEWS", "NONE")).toBe("trafego_site");
    expect(blockOf("campaign-3", "Ganhar seguidores", "UNKNOWN", "NONE")).toBe("trafego_perfil");
  });

  it("mantém campanhas de perfil e site em blocos distintos no mesmo período", () => {
    const ads = [
      ad({ id: "profile-ad", campaignId: "profile", campaignName: "Baita", optimizationGoal: "PROFILE_VISIT" }),
      ad({ id: "site-ad", campaignId: "site", campaignName: "Landing", optimizationGoal: "LANDING_PAGE_VIEWS" }),
    ];
    const { postBlock } = blockResolver(config(), ads);

    expect(postBlock(ad({ campaignId: "profile", campaignName: "Baita", objective: "LINK_CLICKS" }))).toBe("trafego_perfil");
    expect(postBlock(ad({ campaignId: "site", campaignName: "Landing", objective: "LINK_CLICKS" }))).toBe("trafego_site");
  });
});

// Decisão de 22/09: o relatório de conversão nunca mostra CPM (exclusivo do
// relatório de anúncios) e só mostra "%" de variação quando é ganho > 1% —
// negativo ou pouco relevante fica sem a linha inteira. O relatório de
// anúncios continua com a política "always" (mostra tudo, sempre) e nunca
// declara `hideMetrics`.
describe("showsDelta — política do relatório de conversão", () => {
  it('"always" (relatório de anúncios) mostra mesmo queda ou variação mínima', () => {
    expect(showsDelta("always", 80, 100, false)).toBe(true);
    expect(showsDelta("always", 100.1, 100, false)).toBe(true);
    expect(showsDelta("always", null, null, false)).toBe(true);
  });

  it('"positive_only" (relatório de conversão) esconde queda', () => {
    expect(showsDelta("positive_only", 80, 100, false)).toBe(false);
  });

  it('"positive_only" esconde ganho pequeno demais (piso de 1%)', () => {
    expect(showsDelta("positive_only", 100.5, 100, false)).toBe(false);
  });

  it('"positive_only" mostra ganho representativo (> 1%)', () => {
    expect(showsDelta("positive_only", 105, 100, false)).toBe(true);
  });

  it('"positive_only" respeita métrica inversa (custo caindo é bom)', () => {
    expect(showsDelta("positive_only", 90, 100, true)).toBe(true);
    expect(showsDelta("positive_only", 110, 100, true)).toBe(false);
  });

  it('"positive_only" sem período anterior nunca mostra', () => {
    expect(showsDelta("positive_only", 100, null, false)).toBe(false);
    expect(showsDelta("positive_only", 100, 0, false)).toBe(false);
  });
});

describe("kpiForDef — showDelta chega pronto no KpiCard", () => {
  const cur = [ad({ metrics: { custo: 100, alcance: 1000 } })];
  const prevQueda = [ad({ metrics: { custo: 100, alcance: 1200 } })];
  const prevGanho = [ad({ metrics: { custo: 100, alcance: 800 } })];
  const cm = DEFAULT_BUILTIN_TEMPLATE.config.prefs.customMetrics;

  it("métrica direta: queda de alcance não mostra delta em positive_only", () => {
    const kpi = kpiForDef({ label: "Alcance", metric: "alcance" }, cur, prevQueda, cm, "positive_only");
    expect(kpi.showDelta).toBe(false);
    expect(kpi.value).toBe(1000);
  });

  it("métrica direta: ganho de alcance mostra delta em positive_only", () => {
    const kpi = kpiForDef({ label: "Alcance", metric: "alcance" }, cur, prevGanho, cm, "positive_only");
    expect(kpi.showDelta).toBe(true);
  });

  it("relatório de anúncios (política padrão) sempre mostra, mesmo em queda", () => {
    const kpi = kpiForDef({ label: "Alcance", metric: "alcance" }, cur, prevQueda, cm);
    expect(kpi.showDelta).toBe(true);
  });

  it("razão (custo por clique): mais barato é ganho, mesmo com valor caindo", () => {
    const curClick = [ad({ metrics: { custo: 100, cliquesLink: 50 } })];
    const prevClickCaro = [ad({ metrics: { custo: 100, cliquesLink: 25 } })];
    const kpi = kpiForDef({ label: "Custo por clique", ratio: ["custo", "cliquesLink"] }, curClick, prevClickCaro, cm, "positive_only");
    expect(kpi.showDelta).toBe(true);
  });
});

describe("CPM some do relatório de conversão via hideMetrics", () => {
  it("blockKpisOf ainda declara CPM no template — o corte é do chamador (salesReportPdf), não do template", () => {
    const config = templateById("builtin-perfil-negocio-local").config;
    const defs = blockKpisOf(config, "trafego_perfil");
    const refs = defs.flatMap((d) => [d.metric, ...(d.ratio ?? [])]);
    // Reflete o template builtin-perfil-negocio-local: CPM está lá porque o
    // relatório de anúncios precisa dele; é `hideMetrics={["cpm"]}` em
    // salesReportPdf.tsx que o esconde só na conversão.
    expect(refs).toContain("cpm");
  });
});

/** Rótulos dos KpiCard na árvore renderizada, em ordem.
 *
 *  Anda a árvore em vez de indexar `props.children[1]...[0]`: a diagramação do
 *  bloco mudou duas vezes (23/09 atômico, 24/09 quebrável no encaixe, com o
 *  kicker grudado na primeira cabeça) e a cada vez os índices fixos quebravam
 *  seis testes que não têm nada a ver com paginação. O que estes testes
 *  afirmam é QUAIS KPIs saem, não onde eles moram na árvore.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kpiLabels(node: any): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(kpiLabels);
  if (typeof node !== "object") return [];
  const label = node.props?.label;
  if (typeof label === "string" && "value" in (node.props ?? {})) return [label];
  return kpiLabels(node.props?.children);
}

/** Quantos blocos por objetivo a seção renderizou. Cada bloco tem exatamente
 *  uma cabeça com o rótulo do objetivo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockCount(element: any): number {
  const labels = Object.values(CAMPAIGN_BLOCK_LABEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any): number => {
    if (node === null || node === undefined || typeof node === "boolean") return 0;
    if (Array.isArray(node)) return node.reduce((n, c) => n + walk(c), 0);
    if (typeof node !== "object") return 0;
    const kids = node.props?.children;
    if (typeof kids === "string" && labels.includes(kids)) return 1;
    return walk(kids);
  };
  return walk(element);
}

// Uma regra fixa por relatório, em vez de condicional por política de template.
describe("kpiSource — o template manda na conversão, não no relatório interno", () => {
  const posts = [ad({ optimizationGoal: "PROFILE_VISIT", metrics: { custo: 10, alcance: 100, profileVisits: 5 } })];

  const labelsRenderizados = (kpiSource?: "template" | "all") => {
    const element = CampaignBlocksSection({
      config: templateById("builtin-ecommerce").config,
      posts,
      prevPosts: [],
      adPosts: posts,
      ...(kpiSource ? { kpiSource } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any;
    return kpiLabels(element);
  };

  it("padrão (conversão) respeita a lista curada do template do cliente", () => {
    // builtin-ecommerce declara 4 KPIs para trafego_perfil.
    expect(labelsRenderizados()).toEqual(["Investimento", "Alcance", "Visitas ao perfil", "Custo por visita"]);
  });

  it('"all" (anúncios, interno) mostra o conjunto completo do objetivo, ignorando a curadoria', () => {
    const labels = labelsRenderizados("all");
    expect(labels).toEqual(BLOCK_KPIS_DEFAULT.trafego_perfil.map((k) => k.label));
    expect(labels).toContain("Mensagens");
  });
});

// Compra do pixel é o desfecho do objetivo de site, mas nem toda conta tem
// pixel — sem a marca `optional` o cliente receberia "Sem integração" toda
// semana (24/09).
describe("KPI optional — aparece com dado, some sem", () => {
  const siteAd = (metrics: MetaPost["metrics"]) =>
    ad({ campaignName: "Site", optimizationGoal: "LANDING_PAGE_VIEWS", metrics });

  const labels = (metrics: MetaPost["metrics"]) => {
    const posts = [siteAd(metrics)];
    const element = CampaignBlocksSection({
      config: templateById("builtin-ecommerce").config,
      posts,
      prevPosts: [],
      adPosts: posts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any;
    return kpiLabels(element);
  };

  it("conta com compras no período mostra o desfecho", () => {
    const l = labels({ custo: 68.62, alcance: 5933, cliquesLink: 35, compras: 3 });
    expect(l).toContain("Compras");
    expect(l).toContain("Custo por compra");
  });

  it("conta sem pixel não ganha card vazio", () => {
    const l = labels({ custo: 68.62, alcance: 5933, cliquesLink: 35 });
    expect(l).not.toContain("Compras");
    expect(l).not.toContain("Custo por compra");
    expect(l).toContain("Cliques no link");
  });

  it("zero compras DITO pelo pixel continua sendo informação — o card fica", () => {
    const l = labels({ custo: 68.62, alcance: 5933, cliquesLink: 35, compras: 0 });
    expect(l).toContain("Compras");
  });
});

describe("seguidores não pode depender do template lembrar de declarar o bloco", () => {
  it("trafego_perfil aparece via extraKpis mesmo com blockKpis vazio (23/09, garantia estrutural)", () => {
    const bareConfig: PerformanceTemplateConfig = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      reportKpiPolicy: "perfil_negocio_local",
      blockKpis: {},
    };
    const posts = [ad({ optimizationGoal: "PROFILE_VISIT" })];
    const element = CampaignBlocksSection({
      config: bareConfig,
      posts,
      prevPosts: [],
      adPosts: posts,
      extraKpis: (block: CampaignBlock) => (block === "trafego_perfil"
        ? [{ label: "Novos seguidores", value: 66, previous: null, kind: "number" as const, inverse: false, notIntegrated: false }]
        : []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any;

    expect(element).not.toBeNull();
    expect(blockCount(element)).toBe(1);
    expect(kpiLabels(element)).toEqual(["Novos seguidores"]);
  });

  it("sem extraKpis e sem KPI de template, o bloco não aparece (nada real para mostrar)", () => {
    const bareConfig: PerformanceTemplateConfig = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      reportKpiPolicy: "perfil_negocio_local",
      blockKpis: {},
    };
    const posts = [ad({ optimizationGoal: "PROFILE_VISIT" })];
    const element = CampaignBlocksSection({
      config: bareConfig,
      posts,
      prevPosts: [],
      adPosts: posts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as any;

    expect(element).toBeNull();
  });
});
