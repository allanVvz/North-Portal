import { describe, expect, it } from "vitest";
import {
  attentionCard, creativeHighlights, creativeRows, deltaOf, efficiencyOf, mediaNarrative, mediaTotals, objectiveSummaries,
  type MediaTotals,
} from "./adsInsights";
import type { MetaPost } from "@/lib/windsor";

const post = (over: Partial<MetaPost> & { metrics: MetaPost["metrics"] }): MetaPost => ({
  id: Math.random().toString(36), date: "2026-09-10", accountId: "a", accountName: "A", platform: "instagram",
  source: "paid", type: "IMAGE" as MetaPost["type"], caption: "c", permalink: null, ...over,
});

describe("deltaOf", () => {
  it("investimento é neutro: nunca ganha cor", () => {
    expect(deltaOf(80, 100, "neutral").tone).toBe("neutral");
  });
  it("custo que sobe é ruim; volume que sobe é bom", () => {
    expect(deltaOf(130, 100, "lower_is_better").tone).toBe("bad");
    expect(deltaOf(130, 100, "higher_is_better").tone).toBe("good");
  });
  it("oscilação abaixo de 5% não ganha cor", () => {
    expect(deltaOf(103, 100, "higher_is_better").tone).toBe("neutral");
  });
  it("sem anterior não inventa variação", () => {
    expect(deltaOf(10, null, "higher_is_better")).toEqual({ pct: null, tone: "neutral", text: "sem semana anterior" });
  });
});

describe("mediaTotals", () => {
  it("soma campanhas pagas e calcula custo por conversa", () => {
    const t = mediaTotals([
      post({ metrics: { custo: 114.96, alcance: 11913, cliques: 300, contatos: 5 } }),
      post({ metrics: { custo: 69.82, alcance: 4496, cliques: 174, contatos: 18 } }),
      post({ source: "organic", metrics: { alcance: 9999 } }),
    ]);
    expect(t.spend).toBeCloseTo(184.78);
    expect(t.reach).toBe(16409);
    expect(t.conversations).toBe(23);
    expect(t.costPerConversation).toBeCloseTo(8.03, 2);
  });
});

describe("métrica técnica só quando crítica", () => {
  const blockOf = (p: MetaPost) => (p.campaignName === "eng" ? "engajamento" : "trafego_site") as never;
  const cur = [
    post({ campaignName: "site", metrics: { custo: 115, alcance: 11913, cliquesLink: 241, contatos: 5 } }),
    post({ campaignName: "eng", metrics: { custo: 70, alcance: 4496, engajamento: 401, contatos: 18 } }),
  ];
  const prev = [
    post({ campaignName: "site", metrics: { custo: 140, alcance: 20000, cliquesLink: 340, contatos: 4 } }),
    post({ campaignName: "eng", metrics: { custo: 84, alcance: 6600, engajamento: 1958, contatos: 22 } }),
  ];

  it("custo por engajamento 4× mais caro é crítico e vem explicado", () => {
    const e = efficiencyOf("engajamento", cur[1].metrics, prev[1].metrics)!;
    expect(e.critical).toBe(true);
    expect(e.explanation).toMatch(/^Cada engajamento custou R\$.*mais caro que na semana anterior\.$/);
  });

  it("CPC que piorou pouco NÃO ocupa espaço: o slot vira parte da verba", () => {
    const [site] = objectiveSummaries(cur, prev, blockOf).filter((o) => o.block === "trafego_site");
    expect(site.efficiency?.critical).toBe(false);
    expect(site.slots.map((s) => s.label)).toContain("Parte da verba");
    expect(site.slots.some((s) => s.label.startsWith("CPC"))).toBe(false);
  });

  it("o cartão de atenção pega o crítico; sem crítico, mostra o objetivo que mais conversou", () => {
    const objectives = objectiveSummaries(cur, prev, blockOf);
    expect(attentionCard(objectives)?.label).toBe("Atenção · Engajamento");
    const calm = objectiveSummaries(cur, cur, blockOf);
    expect(attentionCard(calm)?.label).toBe("Objetivo que mais conversou");
    expect(attentionCard(calm)?.value).toBe("Engajamento");
  });
});

describe("criativos", () => {
  const ad = (adId: string, metrics: MetaPost["metrics"]) => post({ adId, adName: adId, campaignName: "x", metrics });
  const { rows, hiddenNoise } = creativeRows([
    ad("promos", { custo: 69.75, impressoes: 7800, cliquesLink: 82, contatos: 18 }),
    ad("apresentacao", { custo: 54.99, impressoes: 5900, cliquesLink: 193, contatos: 0 }),
    ad("ppf", { custo: 53.9, impressoes: 7500, cliquesLink: 42, contatos: 5 }),
    ad("loja-online", { custo: 0.07, impressoes: 4, cliquesLink: 0, contatos: 0 }),
  ]);

  it("gasto irrisório não vira linha", () => {
    expect(hiddenNoise).toBe(1);
    expect(rows.map((r) => r.adId)).not.toContain("loja-online");
  });

  it("marca mais conversas, mais cliques e revisar por regra", () => {
    const reading = Object.fromEntries(rows.map((r) => [r.adId, r.reading]));
    expect(reading).toEqual({ promos: "conversas", apresentacao: "cliques", ppf: "estavel" });
  });

  it("destaques falam português, não CTR", () => {
    const h = creativeHighlights(rows, 23);
    expect(h[0]).toMatchObject({ tag: "★ Mais conversas", value: "18 conversas" });
    expect(h[1].detail).toBe("levou gente ao site, mas nenhuma conversa");
    expect(h.map((x) => x.value).join(" ")).not.toMatch(/CTR/);
  });

  // Conta de perfil/loja (a Baita): nenhum criativo recebe conversa, e isso é o
  // normal da conta — não pode virar "revisar" para todos.
  it("conta sem conversa: revisar só quem responde a clique bem abaixo dos pares", () => {
    const r = creativeRows([
      ad("adconheca", { custo: 17, impressoes: 3000, cliquesLink: 90, contatos: 0 }),
      ad("sereno", { custo: 20, impressoes: 2500, cliquesLink: 72, contatos: 0 }),
      ad("engajados", { custo: 20, impressoes: 2800, cliquesLink: 80, contatos: 0 }),
      ad("fraco", { custo: 16, impressoes: 4000, cliquesLink: 20, contatos: 0 }),
    ]).rows;
    const reading = Object.fromEntries(r.map((x) => [x.adId, x.reading]));
    expect(reading.fraco).toBe("revisar");
    expect(reading.sereno).toBe("estavel");
    expect(reading.engajados).toBe("estavel");
    expect(creativeHighlights(r, 0).find((h) => h.tag === "! Revisar")?.detail).toMatch(/^investidos com resposta abaixo dos outros criativos/);
  });

  it("revisar: levou fatia relevante da verba sem conversa", () => {
    const r = creativeRows([
      ad("a", { custo: 60, impressoes: 5000, cliquesLink: 50, contatos: 10 }),
      ad("b", { custo: 40, impressoes: 4000, cliquesLink: 60, contatos: 3 }),
      ad("c", { custo: 30, impressoes: 8000, cliquesLink: 3, contatos: 0 }),
    ]).rows;
    expect(r.find((x) => x.adId === "c")?.reading).toBe("revisar");
  });
});

describe("mediaNarrative — descreve, não atribui causa", () => {
  const base: MediaTotals = { spend: 233, reach: 26833, clicks: 708, conversations: 26, profileVisits: 714, engagement: 7238, impressions: 40000, costPerConversation: 8.96 };
  it("perdeu alcance e conversas caíram", () => {
    const cur = { ...base, reach: 16424, conversations: 23, spend: 184.82, costPerConversation: 8.04 };
    const n = mediaNarrative(cur, base, "02/09 a 08/09");
    expect(n.headline).toBe("A mídia perdeu alcance e as conversas também caíram.");
    expect(n.headline).not.toMatch(/porque|por causa/);
    expect(n.body).toContain("em relação a 02/09 a 08/09");
  });
  it("sem semana anterior: frase de primeira semana", () => {
    expect(mediaNarrative(base, null, null).body).toMatch(/Primeira semana/);
  });
});
