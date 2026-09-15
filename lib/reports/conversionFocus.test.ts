import { describe, expect, it } from "vitest";
import { costLadder, focusOf, followersNarrative, historyChart, journeyFor, resultKpis } from "./conversionFocus";
import type { MediaTotals } from "./adsInsights";

const nada = { vendas: null, agendamentos: null, receita: null, seguidores: null };
const media: MediaTotals = { spend: 184.78, reach: 16409, clicks: 474, conversations: 23, profileVisits: 609, engagement: 3712, impressions: 30000, costPerConversation: 8.03 };

describe("focusOf — a conversão mais funda que foi informada", () => {
  it("venda ou receita vencem", () => {
    expect(focusOf({ ...nada, vendas: 5, seguidores: 841 })).toBe("vendas");
    expect(focusOf({ ...nada, receita: 4100 })).toBe("vendas");
  });
  it("agendamento vence seguidor", () => {
    expect(focusOf({ ...nada, agendamentos: 8, seguidores: 841 })).toBe("agendamentos");
  });
  it("só seguidores", () => {
    expect(focusOf({ ...nada, seguidores: 1251 })).toBe("seguidores");
  });
  it("nada informado cai na mídia", () => {
    expect(focusOf(nada)).toBe("midia");
  });
});

describe("journeyFor", () => {
  it("vendas: termina em vendas e fala em proporção quando cruza fontes", () => {
    const j = journeyFor("vendas", media, { ...nada, vendas: 5, agendamentos: 8 }, null);
    expect(j.stages.map((s) => s.label)).toEqual(["Alcance", "Cliques", "Conversas", "Agendamentos", "Vendas"]);
    expect(j.gaps[2]).toBe("agendamentos = 34,78% das conversas");
    expect(j.gaps[2]).not.toMatch(/viraram/);
    expect(j.gaps[3]).toBe("62,5% dos agendamentos viraram venda");
    expect(j.crossesSources).toBe(true);
  });
  it("vendas sem agendamento informado não desenha etapa vazia", () => {
    const j = journeyFor("vendas", media, { ...nada, vendas: 5 }, null);
    expect(j.stages.map((s) => s.label)).toEqual(["Alcance", "Cliques", "Conversas", "Vendas"]);
  });
  it("seguidores: alcance → visitas → seguidores novos", () => {
    const j = journeyFor("seguidores", media, { ...nada, seguidores: 1251 }, 37);
    expect(j.stages.map((s) => s.label)).toEqual(["Alcance", "Visitas ao perfil", "Seguidores novos"]);
    expect(j.gaps[1]).toBe("seguidores novos = 6,08% das visitas");
  });
});

describe("resultKpis", () => {
  it("vendas: receita primeiro, sem cartão para o que não foi informado", () => {
    const k = resultKpis({ kind: "vendas", cur: { ...nada, receita: 4100, vendas: 5 }, prev: null, media, prevMedia: null, followersGain: null, prevFollowersGain: null });
    expect(k.map((x) => x.label)).toEqual(["Receita", "Vendas", "Ticket médio", "Investimento"]);
  });
  it("seguidores: o ganho é o número principal", () => {
    const k = resultKpis({ kind: "seguidores", cur: { ...nada, seguidores: 1251 }, prev: { ...nada, seguidores: 1214 }, media, prevMedia: media, followersGain: 37, prevFollowersGain: 34 });
    expect(k[0]).toMatchObject({ label: "Seguidores novos", value: "+37" });
    expect(k[0].delta.text).toBe("+34 na semana anterior");
  });
  it("investimento entra sem cor", () => {
    const k = resultKpis({ kind: "vendas", cur: { ...nada, vendas: 5 }, prev: null, media: { ...media, spend: 184.78 }, prevMedia: { ...media, spend: 233 }, followersGain: null, prevFollowersGain: null });
    expect(k.find((x) => x.label === "Investimento")?.delta.tone).toBe("neutral");
  });
});

describe("costLadder", () => {
  it("só as etapas que existem", () => {
    expect(costLadder(184.78, 23, { ...nada, vendas: 5 }).map((s) => s.label)).toEqual(["por conversa", "por venda"]);
  });
  it("sem investimento não há escada", () => {
    expect(costLadder(null, 23, { ...nada, vendas: 5 })).toEqual([]);
  });
});

describe("historyChart", () => {
  const p = (periodTo: string, v: Partial<{ vendas: number; agendamentos: number; seguidores: number }>) =>
    ({ periodTo, vendas: v.vendas ?? null, agendamentos: v.agendamentos ?? null, receita: null, seguidores: v.seguidores ?? null });
  it("vendas: agendamentos e vendas, do mais antigo ao mais recente", () => {
    const h = historyChart("vendas", [p("2026-09-15", { vendas: 5, agendamentos: 8 }), p("2026-09-08", { vendas: 4, agendamentos: 6 })])!;
    expect(h.periods).toEqual(["08/09", "15/09"]);
    expect(h.series.map((s) => s.values)).toEqual([[6, 8], [4, 5]]);
  });
  it("um ponto só não é histórico", () => {
    expect(historyChart("seguidores", [p("2026-09-15", { seguidores: 1251 })])).toBeNull();
  });
});

describe("followersNarrative", () => {
  it("compara o ritmo, não afirma causa", () => {
    const n = followersNarrative(37, 34, 1251, 560);
    expect(n.headline).toBe("+37 seguidores novos — ritmo acima da semana anterior.");
    expect(n.body).toContain("A mídia levou 560 visitas ao perfil no período.");
  });
  it("primeira semana: total, sem ganho inventado", () => {
    expect(followersNarrative(null, null, 1214, 591).headline).toBe("1.214 seguidores no perfil.");
  });
});
