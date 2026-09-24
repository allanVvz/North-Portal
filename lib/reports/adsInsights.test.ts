import { describe, expect, it } from "vitest";
import {
  creativeBadges, creativeHighlights, creativeRows, deltaOf, funnelWidths, mediaAlert, mediaAnalysis, mediaFunnel,
  mediaTotals, objectiveRows, objectiveScopedMediaTotals, purchasesNote, stageGap, weeklyTrend,
  type MediaTotals,
} from "./adsInsights";
import type { MetaPost } from "@/lib/windsor";
import { DEFAULT_BUILTIN_TEMPLATE } from "@/lib/performanceTemplates";
import { blockResolver } from "./campaignBlockKpis";

const post = (over: Partial<MetaPost> & { metrics: MetaPost["metrics"] }): MetaPost => ({
  id: Math.random().toString(36), date: "2026-09-12", accountId: "a", accountName: "A", platform: "instagram",
  source: "paid", type: "IMAGE" as MetaPost["type"], caption: "c", permalink: null, ...over,
});

const blockOf = (p: MetaPost) => (p.campaignName === "eng" ? "engajamento" : "trafego_site") as never;

// Semana real da CRIS CAR CARE (09–15/09) contra 02–08/09.
const crisCur = [
  post({ campaignName: "site", metrics: { custo: 115, alcance: 11924, impressoes: 16000, cliques: 300, cliquesLink: 241, contatos: 5 } }),
  post({ campaignName: "eng", metrics: { custo: 69.82, alcance: 4505, impressoes: 9000, cliques: 174, engajamento: 401, contatos: 18 } }),
];
const crisPrev = [
  post({ campaignName: "site", date: "2026-09-05", metrics: { custo: 150, alcance: 20000, impressoes: 26000, cliques: 480, cliquesLink: 368, contatos: 4 } }),
  post({ campaignName: "eng", date: "2026-09-05", metrics: { custo: 83.02, alcance: 6833, impressoes: 12000, cliques: 228, engajamento: 1958, contatos: 22 } }),
];

describe("deltaOf", () => {
  it("investimento é neutro", () => expect(deltaOf(80, 100, "neutral").tone).toBe("neutral"));
  it("custo que sobe é ruim; volume que sobe é bom", () => {
    expect(deltaOf(130, 100, "lower_is_better").tone).toBe("bad");
    expect(deltaOf(130, 100, "higher_is_better").tone).toBe("good");
  });
  it("sem anterior não inventa variação", () => expect(deltaOf(10, null, "higher_is_better").pct).toBeNull());
});

describe("mediaTotals", () => {
  it("soma campanhas pagas e calcula CTR e custo por conversa", () => {
    const t = mediaTotals(crisCur);
    expect(t.spend).toBeCloseTo(184.82);
    expect(t.conversations).toBe(23);
    expect(t.ctr).toBeCloseTo((474 / 25000) * 100);
    expect(t.costPerConversation).toBeCloseTo(8.04, 2);
  });
});

describe("objectiveScopedMediaTotals — a porta de cada etapa do funil", () => {
  it("clique/landing view incidental numa campanha de perfil não vira 'visitas ao site' fantasma", () => {
    // Caso real: Baita não tem campanha de site, mas a Meta reportou 2
    // cliques de link incidentais (bio/CTA) na campanha de perfil.
    const config = { ...DEFAULT_BUILTIN_TEMPLATE.config, campaignBlocks: { Perfil: "trafego_perfil" as const } };
    const posts = [
      post({ campaignName: "Perfil", metrics: { custo: 74.88, alcance: 10913, profileVisits: 342, cliquesLink: 2, landingPageViews: 2 } }),
    ];
    const { postBlock } = blockResolver(config, posts);
    const t = objectiveScopedMediaTotals(posts, postBlock);
    expect(t.profileVisits).toBe(342);
    expect(t.landingViews).toBeNull();
    expect(t.linkClicks).toBeNull();
    expect(t.clicks).toBeNull();
    // Alcance é de conta inteira, não escopado por objetivo.
    expect(t.reach).toBe(10913);
  });

  it("com campanha de site real, visitas ao site aparecem normalmente", () => {
    const config = { ...DEFAULT_BUILTIN_TEMPLATE.config, campaignBlocks: { Site: "trafego_site" as const } };
    const posts = [post({ campaignName: "Site", metrics: { custo: 68.62, alcance: 5933, cliquesLink: 41 } })];
    const { postBlock } = blockResolver(config, posts);
    const t = objectiveScopedMediaTotals(posts, postBlock);
    expect(t.linkClicks).toBe(41);
  });

  it("CRIS 15–21/09 — com campanha de site, o funil soma as visitas ao site da CONTA (41, não 29)", () => {
    // Decisão de 24/09: o funil conta a jornada da conta. As 12 visitas das
    // campanhas de perfil e engajamento são reais; o recorte (29) fica em
    // "Mídia por objetivo".
    const config = {
      ...DEFAULT_BUILTIN_TEMPLATE.config,
      campaignBlocks: { Vendas: "trafego_site" as const, Trafego: "trafego_perfil" as const, Eng: "mensagens" as const },
    };
    const posts = [
      post({ campaignName: "Vendas", metrics: { custo: 68.62, landingPageViews: 29, cliquesLink: 41, profileVisits: 231, contatos: 7 } }),
      post({ campaignName: "Trafego", metrics: { custo: 67.36, landingPageViews: 9, cliquesLink: 221, profileVisits: 132 } }),
      post({ campaignName: "Eng", metrics: { custo: 76.96, landingPageViews: 3, cliquesLink: 87, profileVisits: 299, contatos: 17 } }),
    ];
    const { postBlock } = blockResolver(config, posts);
    const t = objectiveScopedMediaTotals(posts, postBlock);
    expect(t.landingViews).toBe(41);
    expect(t.linkClicks).toBe(349);
    // Perfil também soma a conta: o @ de todo anúncio leva ao perfil.
    expect(t.profileVisits).toBe(662);
    // Conversas também: a campanha de vendas abriu 7 além das 17 da de mensagens.
    expect(t.conversations).toBe(24);
  });

  it("conta sem campanha de perfil não ganha etapa de perfil com visitas incidentais", () => {
    const config = { ...DEFAULT_BUILTIN_TEMPLATE.config, campaignBlocks: { Site: "trafego_site" as const } };
    const posts = [post({ campaignName: "Site", metrics: { custo: 50, landingPageViews: 20, profileVisits: 80 } })];
    const { postBlock } = blockResolver(config, posts);
    expect(objectiveScopedMediaTotals(posts, postBlock).profileVisits).toBeNull();
  });

  it("conversas somam a conta quando existe campanha de mensagens", () => {
    const config = { ...DEFAULT_BUILTIN_TEMPLATE.config, campaignBlocks: { Perfil: "trafego_perfil" as const, Msg: "mensagens" as const } };
    const posts = [
      post({ campaignName: "Perfil", metrics: { custo: 10, contatos: 3 } }),
      post({ campaignName: "Msg", metrics: { custo: 20, contatos: 17 } }),
    ];
    const { postBlock } = blockResolver(config, posts);
    const t = objectiveScopedMediaTotals(posts, postBlock);
    expect(t.conversations).toBe(20);
  });

  it("sem campanha de mensagens, conversas incidentais não viram etapa (Baita)", () => {
    const config = { ...DEFAULT_BUILTIN_TEMPLATE.config, campaignBlocks: { Perfil: "trafego_perfil" as const } };
    const posts = [post({ campaignName: "Perfil", metrics: { custo: 74.88, profileVisits: 346, contatos: 2 } })];
    const { postBlock } = blockResolver(config, posts);
    const t = objectiveScopedMediaTotals(posts, postBlock);
    expect(t.conversations).toBeNull();
    expect(t.costPerConversation).toBeNull();
  });
});

describe("objectiveRows por objetivo real", () => {
  const campaigns = [
    post({
      id: "profile-campaign", campaignId: "profile", campaignName: "Baita", objective: "LINK_CLICKS",
      metrics: { custo: 80, cliquesLink: 90, profileVisits: 40 },
    }),
    post({
      id: "site-campaign", campaignId: "site", campaignName: "Landing", objective: "LINK_CLICKS",
      metrics: { custo: 60, cliquesLink: 30, landingPageViews: 12 },
    }),
    post({
      id: "messages-campaign", campaignId: "messages", campaignName: "WhatsApp",
      metrics: { custo: 50, contatos: 10 },
    }),
  ];
  const ads = [
    post({ id: "profile-ad", campaignId: "profile", campaignName: "Baita", optimizationGoal: "PROFILE_VISIT", metrics: {} }),
    post({ id: "site-ad", campaignId: "site", campaignName: "Landing", optimizationGoal: "LANDING_PAGE_VIEWS", metrics: {} }),
    post({ id: "messages-ad", campaignId: "messages", campaignName: "WhatsApp", optimizationGoal: "CONVERSATIONS", metrics: {} }),
  ];
  const { postBlock } = blockResolver(DEFAULT_BUILTIN_TEMPLATE.config, ads);
  const rows = objectiveRows(campaigns, [], postBlock, "visitas");

  it("separa perfil, site e mensagens, cada qual com sua própria métrica e custo", () => {
    expect(rows.map((row) => row.block)).toEqual(["trafego_perfil", "trafego_site", "mensagens"]);
    expect(rows.find((row) => row.block === "trafego_perfil")).toMatchObject({
      resultLabel: "Visitas ao perfil", result: 40, costPerResult: 2,
    });
    expect(rows.find((row) => row.block === "trafego_site")).toMatchObject({
      resultLabel: "Visualizações da página de destino", result: 12, costPerResult: 5,
    });
    expect(rows.find((row) => row.block === "mensagens")).toMatchObject({
      resultLabel: "Conversas", result: 10, costPerResult: 5,
    });
  });

  it("usa cliques no link para site quando não há visualização da página de destino", () => {
    const site = post({ campaignId: "site", campaignName: "Landing", metrics: { custo: 45, cliques: 100, cliquesLink: 15 } });
    const [row] = objectiveRows([site], [], postBlock, "visitas");

    expect(row).toMatchObject({ resultLabel: "Cliques no link", result: 15, costPerResult: 3 });
  });
});

describe("funil", () => {
  it("larguras em escala log: proporcionais, legíveis e nunca crescentes", () => {
    const w = funnelWidths([16424, 474, 23]);
    expect(w[0]).toBeGreaterThanOrEqual(0.94);
    expect(w[1]).toBeLessThan(w[0]);
    expect(w[2]).toBeLessThan(w[1]);
    expect(w[2]).toBeGreaterThanOrEqual(0.36);
  });

  it("etapa maior que a anterior não alarga o funil", () => {
    const w = funnelWidths([12569, 404, 562]);
    expect(w[2]).toBeLessThan(w[1]);
  });

  // "Um funil verdadeiro": a silhueta tem que ser honesta em qualquer combinação
  // de números reais, não só nas duas fixtures acima. Estas propriedades são o
  // contrato geométrico — se alguma cair, o desenho passou a mentir.
  it.each([
    [[16424, 474, 23]],
    [[12569, 404, 562]],
    [[10702, 742, 15]],
    [[5976, 162, 66]],
    [[1000, 999, 998]],
    [[100, 1]],
    [[7, 5, 3, 2, 1]],
    [[50000, 12000, 3000, 400, 21]],
  ])("silhueta honesta para %j", (values) => {
    const w = funnelWidths(values);
    expect(w).toHaveLength(values.length);
    // 1. nunca alarga para baixo — um funil que engorda não é funil;
    for (let i = 1; i < w.length; i += 1) expect(w[i]).toBeLessThan(w[i - 1]);
    // 2. cabe na caixa e nunca some;
    for (const width of w) {
      expect(width).toBeGreaterThanOrEqual(0.36);
      expect(width).toBeLessThanOrEqual(1);
    }
    // 3. o topo é a boca do funil.
    expect(w[0]).toBeGreaterThanOrEqual(0.94);
  });

  it("ordem de grandeza maior continua mais larga que a menor", () => {
    const w = funnelWidths([10000, 1000, 100]);
    expect(w[0] - w[1]).toBeGreaterThan(0);
    expect(w[1] - w[2]).toBeGreaterThan(0);
  });

  // A regra antiga era "sem visita ao site no meio": ela existia para a visita ao
  // site não virar um degrau ENTRE cliques e conversas, o que produziria uma taxa
  // falsa (a conversa não sai do site). O modelo novo respeita a mesma restrição
  // por outro caminho: site e perfil são o MESMO nível, lado a lado, nunca em
  // sequência. Com landing page view disponível, é ela que nomeia a visita ao site.
  it("conversas: a visita ao site é um nível, nunca um degrau entre cliques e conversas", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), landingViews: 180, profileVisits: null };
    const f = mediaFunnel(t, "conversas");
    expect(f.map((s) => s.label)).toEqual(["Alcance", "Visitas ao site", "Conversas"]);
    expect(f[1].value).toBe(180);
  });

  it("sem landing page view, o que se pode afirmar é o clique — e o rótulo diz isso", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), landingViews: null, profileVisits: null };
    const f = mediaFunnel(t, "conversas");
    expect(f[1].label).toBe(t.linkClicks !== null ? "Cliques no link" : "Cliques");
  });

  it("site e perfil juntos viram um nível só, partido ao meio", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), landingViews: 180, profileVisits: 562 };
    const nivel = mediaFunnel(t, "conversas")[1];
    expect(nivel.key).toBe("entradas");
    expect(nivel.parts?.map((part) => [part.label, part.value])).toEqual([["Visitas ao site", 180], ["Visitas ao perfil", 562]]);
    expect(nivel.value).toBe(742);
  });

  it("conta só de perfil vai do alcance às visitas ao perfil, sem nível dividido", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), profileVisits: 562, landingViews: null, linkClicks: null, clicks: null };
    const f = mediaFunnel(t, "visitas");
    expect(f.map((s) => s.key)).toEqual(["alcance", "visitas_perfil"]);
    expect(f[1].parts).toBeUndefined();
  });

  it("taxa só entre etapas da mesma fonte", () => {
    const a = { key: "alcance", label: "Alcance", value: 16424, source: "midia" as const };
    const c = { key: "cliques", label: "Cliques", value: 474, source: "midia" as const };
    const ag = { key: "agendamentos", label: "Agendamentos", value: 8, source: "feedback" as const };
    expect(stageGap(a, c)).toBe("2,89% clicaram");
    expect(stageGap(c, ag)).toBe("");
  });
});

describe("mediaAnalysis — o resultado mais justo abre o relatório", () => {
  const cur = mediaTotals(crisCur);
  const prev = mediaTotals(crisPrev);
  const objectives = objectiveRows(crisCur, crisPrev, blockOf, "conversas");
  const { headline, insights } = mediaAnalysis({ cur, prev, outcome: "conversas", objectives, creatives: [], badges: new Map() });

  it("com menos verba e custo melhor, abre pela eficiência — não pela perda", () => {
    expect(headline).toBe("Com 21% menos investimento, a operação manteve 23 conversas a um custo 10% menor.");
  });

  it("concentração por objetivo vira uma frase só", () => {
    // Cliques e engajamentos têm unidades diferentes; não existe share
    // comparável para sustentar uma concentração artificial.
    expect(insights.some((text) => text.includes("concentrou o resultado"))).toBe(false);
  });

  it("nenhuma frase afirma causa nem lista três variações", () => {
    for (const s of [headline, ...insights]) {
      expect(s).not.toMatch(/porque|graças/);
      expect((s.match(/%/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("mediaAlert — no máximo um, e só quando o resultado piorou", () => {
  it("CPE crítico vira alerta quando o resultado próprio do objetivo também cai", () => {
    const objectives = objectiveRows(crisCur, crisPrev, blockOf, "conversas");
    expect(objectives.find((o) => o.block === "engajamento")?.technical?.critical).toBe(true);
    expect(mediaAlert({ cur: mediaTotals(crisCur), prev: mediaTotals(crisPrev), outcome: "conversas", objectives, creatives: [], badges: new Map() }))
      .toMatch(/^Engajamento:.*resultado do objetivo caiu 80%/);
  });

  it("queda forte de resultado com custo pior é alerta", () => {
    const worse = [post({ campaignName: "site", metrics: { custo: 184, alcance: 9000, impressoes: 12000, cliques: 200, contatos: 12 } })];
    const alert = mediaAlert({ cur: mediaTotals(worse), prev: mediaTotals(crisPrev), outcome: "conversas", objectives: [], creatives: [], badges: new Map() });
    expect(alert).toMatch(/^Conversas caíram 54% e o custo por conversa subiu/);
  });
});

describe("criativos", () => {
  const ad = (adId: string, metrics: MetaPost["metrics"]) => post({ adId, adName: adId, campaignName: "x", metrics });

  it("gasto irrisório não vira linha", () => {
    const { rows, hiddenNoise } = creativeRows([ad("a", { custo: 60, impressoes: 5000 }), ad("ruido", { custo: 0.07, impressoes: 4 })], "conversas");
    expect(hiddenNoise).toBe(1);
    expect(rows.map((r) => r.adId)).toEqual(["a"]);
  });

  it("conta com conversa: destaques com significado, até dois por criativo, nenhum 'Estável'", () => {
    const { rows } = creativeRows([
      ad("promos", { custo: 69.75, impressoes: 7800, cliques: 82, contatos: 18 }),
      ad("apresentacao", { custo: 54.99, impressoes: 5900, cliques: 193, contatos: 0 }),
      ad("ppf", { custo: 53.9, impressoes: 7500, cliques: 42, contatos: 5 }),
    ], "conversas");
    const badges = creativeBadges(rows, "conversas");
    const keys = (id: string) => (badges.get(id) ?? []).map((b) => b.key);
    expect(keys("promos")).toEqual(["mais_conversas", "maior_eficiencia"]);
    expect(keys("apresentacao")).toEqual(["trafego_sem_conversao", "melhor_ctr"]);
    for (const list of badges.values()) expect(list.length).toBeLessThanOrEqual(2);
    expect(creativeHighlights(rows, badges, "conversas").map((h) => h.row.adId)).toEqual(["promos", "apresentacao"]);
  });

  it("conta sem conversa: cliques e CTR, e atenção sem resposta para quem gasta sem clique", () => {
    const { rows } = creativeRows([
      ad("adconheca", { custo: 17.35, impressoes: 3000, cliques: 90 }),
      ad("sereno", { custo: 20.56, impressoes: 2500, cliques: 72 }),
      ad("engajados", { custo: 20.53, impressoes: 2800, cliques: 80 }),
      ad("fraco", { custo: 25, impressoes: 6000, cliques: 20 }),
    ], "visitas");
    const badges = creativeBadges(rows, "visitas");
    expect((badges.get("adconheca") ?? []).map((b) => b.key)).toContain("mais_cliques");
    expect((badges.get("fraco") ?? []).map((b) => b.key)).toContain("atencao_sem_resposta");
    expect([...badges.values()].flat().some((b) => b.key === "trafego_sem_conversao")).toBe(false);
  });

  it("explica a mudança: o criativo que carrega a variação da semana", () => {
    const cur = creativeRows([ad("a", { custo: 50, impressoes: 5000, cliques: 50, contatos: 15 }), ad("b", { custo: 50, impressoes: 5000, cliques: 40, contatos: 5 })], "conversas").rows;
    const prev = creativeRows([ad("a", { custo: 50, impressoes: 5000, cliques: 50, contatos: 4 }), ad("b", { custo: 50, impressoes: 5000, cliques: 40, contatos: 6 })], "conversas").rows;
    expect((creativeBadges(cur, "conversas", prev).get("a") ?? []).map((b) => b.key)).toContain("explica_mudanca");
  });

  it("período misto usa o resultado do objetivo de cada criativo", () => {
    const mixed = [
      ad("profile", { custo: 20, cliques: 100, cliquesLink: 80, profileVisits: 10 }),
      ad("site", { custo: 15, cliques: 70, cliquesLink: 20, landingPageViews: 5 }),
      ad("messages", { custo: 12, cliques: 30, contatos: 4 }),
    ];
    mixed[0].campaignName = "profile";
    mixed[1].campaignName = "site";
    mixed[2].campaignName = "messages";
    const blocks = (p: MetaPost) => p.campaignName === "profile"
      ? "trafego_perfil" as const
      : p.campaignName === "site"
        ? "trafego_site" as const
        : "mensagens" as const;
    const { rows } = creativeRows(mixed, "visitas", blocks);

    expect(rows.find((row) => row.adId === "profile")).toMatchObject({ resultLabel: "Visitas ao perfil", result: 10, costPerResult: 2 });
    expect(rows.find((row) => row.adId === "site")).toMatchObject({ resultLabel: "Visualizações da página de destino", result: 5, costPerResult: 3 });
    expect(rows.find((row) => row.adId === "messages")).toMatchObject({ resultLabel: "Conversas", result: 4, costPerResult: 3 });
  });

  it("criativos de perfil recebem destaque por visitas, sem badge de clique ou CTR", () => {
    const profileAds = [
      ad("profile-a", { custo: 20, impressoes: 2000, cliques: 100, cliquesLink: 80, profileVisits: 10 }),
      ad("profile-b", { custo: 18, impressoes: 1800, cliques: 60, cliquesLink: 50, profileVisits: 6 }),
    ];
    const { rows } = creativeRows(profileAds, "visitas", () => "trafego_perfil");
    const badges = creativeBadges(rows, "visitas");
    const allKeys = [...badges.values()].flat().map((badge) => badge.key);

    expect((badges.get("profile-a") ?? []).map((badge) => badge.key)).toContain("mais_visitas_perfil");
    expect(allKeys).not.toContain("mais_cliques");
    expect(allKeys).not.toContain("melhor_ctr");
    expect(creativeHighlights(rows, badges, "visitas")[0].badges[0].label).toBe("Mais visitas ao perfil");
  });
});

describe("weeklyTrend", () => {
  it("semanas fechadas, da mais antiga à mais recente, só com investimento", () => {
    const t = weeklyTrend([
      post({ date: "2026-09-14", metrics: { custo: 100, contatos: 10 } }),
      post({ date: "2026-09-06", metrics: { custo: 80, contatos: 8 } }),
      post({ date: "2026-08-30", metrics: { custo: 90, contatos: 6 } }),
    ], "2026-09-15", "conversas", 5);
    expect(t.map((p) => p.weekTo)).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
    expect(t[2]).toMatchObject({ spend: 100, result: 10, cost: 10 });
  });
});

describe("purchasesNote", () => {
  // A decisão de 24/09: a compra soma no funil do relatório INTERNO, como nota
  // de fechamento, e a composição fica sempre visível — o pixel atribui à
  // campanha, a venda que a equipe informa é da conta inteira, e um número
  // solto apagaria essa diferença.
  it("só pixel: diz que veio do pixel", () => {
    expect(purchasesNote(3, null)).toMatchObject({ total: 3, label: "3 compras", detail: "registradas pelo pixel no período" });
  });

  it("pixel e informada: soma e mostra as duas parcelas", () => {
    expect(purchasesNote(3, 1)).toMatchObject({ total: 4, label: "4 compras", detail: "no período · 3 pelo pixel + 1 informada pela equipe" });
  });

  it("só informada: não atribui ao pixel o que a equipe contou", () => {
    expect(purchasesNote(null, 2)).toMatchObject({ total: 2, label: "2 compras", detail: "informadas pela equipe no período" });
  });

  it("singular tem concordância própria", () => {
    expect(purchasesNote(1, null)).toMatchObject({ label: "1 compra", detail: "registrada pelo pixel no período" });
  });

  it("conta sem pixel e sem venda informada não ganha fecho", () => {
    expect(purchasesNote(null, null)).toBeNull();
  });

  it("zero não vira fecho do funil — o KPI do bloco já mostra o zero do pixel", () => {
    expect(purchasesNote(0, null)).toBeNull();
    expect(purchasesNote(0, 0)).toBeNull();
  });
});

describe("mediaTotals · compras", () => {
  it("soma a conta inteira, não só a campanha de site", () => {
    const totals = mediaTotals([
      post({ metrics: { custo: 50, compras: 3 } }),
      post({ metrics: { custo: 30, compras: 3 } }),
    ]);
    expect(totals.purchases).toBe(6);
  });

  it("conta sem pixel devolve null, nunca 0", () => {
    expect(mediaTotals([post({ metrics: { custo: 50 } })]).purchases).toBeNull();
  });
});

describe("stageGap — conversa não sai de visita", () => {
  const etapa = (key: string, value: number) => ({ key, label: key, value, source: "midia" as const });

  it("visitas → conversas não tem taxa (era o \"3,41% conversaram\" da CRIS)", () => {
    expect(stageGap(etapa("entradas", 703), etapa("conversas", 24))).toBe("");
    expect(stageGap(etapa("visitas_perfil", 150), etapa("conversas", 15))).toBe("");
  });

  it("alcance ou clique → conversas mantém a taxa", () => {
    expect(stageGap(etapa("alcance", 1000), etapa("conversas", 10))).toContain("conversaram");
    expect(stageGap(etapa("cliques", 200), etapa("conversas", 10))).toContain("conversaram");
  });
});
