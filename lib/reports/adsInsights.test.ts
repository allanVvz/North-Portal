import { describe, expect, it } from "vitest";
import {
  creativeBadges, creativeHighlights, creativeRows, deltaOf, funnelWidths, mediaAlert, mediaAnalysis, mediaFunnel,
  mediaTotals, objectiveRows, stageGap, weeklyTrend,
  type MediaTotals,
} from "./adsInsights";
import type { MetaPost } from "@/lib/windsor";

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
    expect(w[2]).toBeLessThanOrEqual(w[1]);
  });

  it("conversas: os mesmos cliques da faixa de números, sem visita ao site no meio", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), landingViews: 180 };
    const f = mediaFunnel(t, "conversas");
    expect(f.map((s) => s.label)).toEqual(["Alcance", "Cliques", "Conversas"]);
    expect(f[1].value).toBe(t.clicks);
  });

  it("conta sem conversa vai do alcance às visitas ao perfil", () => {
    const t: MediaTotals = { ...mediaTotals(crisCur), profileVisits: 562 };
    expect(mediaFunnel(t, "visitas").map((s) => s.key)).toEqual(["alcance", "visitas"]);
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
    expect(insights).toContain("Engajamento concentrou o resultado: recebeu 38% da verba e gerou 78% das conversas.");
  });

  it("nenhuma frase afirma causa nem lista três variações", () => {
    for (const s of [headline, ...insights]) {
      expect(s).not.toMatch(/porque|graças/);
      expect((s.match(/%/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("mediaAlert — no máximo um, e só quando o resultado piorou", () => {
  it("CPE crítico com engajamento entregando conversas NÃO é alerta", () => {
    const objectives = objectiveRows(crisCur, crisPrev, blockOf, "conversas");
    expect(objectives.find((o) => o.block === "engajamento")?.technical?.critical).toBe(true);
    expect(mediaAlert({ cur: mediaTotals(crisCur), prev: mediaTotals(crisPrev), outcome: "conversas", objectives, creatives: [], badges: new Map() })).toBeNull();
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
