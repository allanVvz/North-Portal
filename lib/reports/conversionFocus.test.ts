import { describe, expect, it } from "vitest";
import { costLadder, focusOf, heroFor, historyView, resultAnalysis, resultFunnel, supportFigures, type FocusContext } from "./conversionFocus";
import type { MediaTotals } from "./adsInsights";

const nada = { vendas: null, agendamentos: null, receita: null, seguidores: null };
const media: MediaTotals = {
  spend: 184.78, reach: 16424, impressions: 25000, clicks: 474, linkClicks: 323, ctr: 1.9, landingViews: null,
  profileVisits: 609, conversations: 23, engagement: 3712, costPerConversation: 8.03,
};
const baitaMedia: MediaTotals = { ...media, spend: 96.01, reach: 12569, clicks: 404, profileVisits: 562, conversations: 0, costPerConversation: null };
const baitaPrev: MediaTotals = { ...baitaMedia, spend: 88.37, reach: 15118, profileVisits: 591 };

const ctx = (over: Partial<FocusContext>): FocusContext => ({
  kind: "vendas", cur: nada, prev: null, media, prevMedia: null, followersGain: null, prevFollowersGain: null, prevFollowersTotal: null, ...over,
});

describe("focusOf", () => {
  it("venda ou receita vencem", () => expect(focusOf({ ...nada, vendas: 5, seguidores: 841 })).toBe("vendas"));
  it("agendamento vence seguidor", () => expect(focusOf({ ...nada, agendamentos: 8, seguidores: 841 })).toBe("agendamentos"));
  it("só seguidores", () => expect(focusOf({ ...nada, seguidores: 1251 })).toBe("seguidores"));
  it("nada informado cai na mídia", () => expect(focusOf(nada)).toBe("midia"));
});

describe("figura principal por modo", () => {
  it("seguidores: o ganho grande, a frase de crescimento embaixo", () => {
    const h = heroFor(ctx({ kind: "seguidores", cur: { ...nada, seguidores: 1251 }, media: baitaMedia, followersGain: 37, prevFollowersTotal: 1214 }));
    expect(h.value).toBe("+37");
    expect(h.caption).toBe("O perfil passou de 1.214 para 1.251 e cresceu 3,05%.");
  });

  it("seguidores na primeira semana: total, sem ganho inventado", () => {
    const h = heroFor(ctx({ kind: "seguidores", cur: { ...nada, seguidores: 1214 }, media: baitaMedia }));
    expect(h.label).toBe("seguidores no perfil");
    expect(h.value).toBe("1.214");
  });

  it("vendas com receita: receita é a figura", () => {
    expect(heroFor(ctx({ cur: { ...nada, receita: 4100, vendas: 5, agendamentos: 8 } })).label).toBe("Receita da semana");
  });
});

describe("figuras de apoio", () => {
  it("vendas: nada que não foi informado vira figura", () => {
    const f = supportFigures(ctx({ cur: { ...nada, receita: 4100, vendas: 5 } }));
    expect(f.map((x) => x.label)).toEqual(["Vendas fechadas", "Ticket médio", "Custo de mídia por venda", "Investimento"]);
  });

  it("seguidores: total, visitas, custo por visita — nada de vendas", () => {
    const f = supportFigures(ctx({ kind: "seguidores", cur: { ...nada, seguidores: 1251 }, media: baitaMedia, prevMedia: baitaPrev, followersGain: 37, prevFollowersTotal: 1214 }));
    expect(f.map((x) => x.label)).toEqual(["Seguidores no perfil", "Visitas ao perfil", "Custo por visita", "Investimento"]);
    expect(f.find((x) => x.label === "Investimento")?.delta?.tone).toBe("neutral");
  });
});

describe("funil do resultado", () => {
  it("seguidores: alcance → visitas → seguidores novos → total do perfil (placa-base), sem taxa entre fontes", () => {
    const f = resultFunnel(ctx({ kind: "seguidores", cur: { ...nada, seguidores: 1251 }, media: baitaMedia, followersGain: 37, prevFollowersTotal: 1214 }));
    expect(f.stages.map((s) => s.key)).toEqual(["alcance", "visitas", "seguidores_novos", "total_perfil"]);
    expect(f.stages[3].base).toBe(true);
    expect(f.gaps).toEqual(["4,47% visitaram", "", ""]);
  });

  it("vendas: termina em vendas; taxa só entre agendamento e venda", () => {
    const f = resultFunnel(ctx({ cur: { ...nada, vendas: 5, agendamentos: 8 } }));
    expect(f.stages.map((s) => s.key)).toEqual(["alcance", "cliques", "conversas", "agendamentos", "vendas"]);
    expect(f.gaps[2]).toBe("");
    expect(f.gaps[3]).toBe("62,5% viraram venda");
  });
});

describe("histórico por número de pontos", () => {
  const p = (periodTo: string, v: Partial<{ vendas: number; agendamentos: number; receita: number; seguidores: number }>) =>
    ({ periodTo, vendas: v.vendas ?? null, agendamentos: v.agendamentos ?? null, receita: v.receita ?? null, seguidores: v.seguidores ?? null });

  it("1 ponto: some", () => expect(historyView("seguidores", [p("2026-09-15", { seguidores: 1251 })]).type).toBe("none"));

  it("2 pontos: comparação antes → depois, não gráfico", () => {
    const h = historyView("seguidores", [p("2026-09-08", { seguidores: 1214 }), p("2026-09-15", { seguidores: 1251 })]);
    expect(h).toEqual({ type: "comparison", items: [{ label: "Seguidores no perfil", from: "1.214", to: "1.251", change: "+37", tone: "good" }] });
  });

  it("3+ pontos de seguidores: linha com acumulado", () => {
    const h = historyView("seguidores", [p("2026-09-01", { seguidores: 1179 }), p("2026-09-08", { seguidores: 1214 }), p("2026-09-15", { seguidores: 1251 })]);
    expect(h.type).toBe("chart");
    if (h.type === "chart") {
      expect(h.form).toBe("line");
      expect(h.summary).toBe("+72 seguidores em 2 semanas");
    }
  });

  it("3+ pontos de vendas: colunas de agendamentos e vendas", () => {
    const h = historyView("vendas", [p("2026-09-01", { vendas: 3, agendamentos: 5 }), p("2026-09-08", { vendas: 4, agendamentos: 6 }), p("2026-09-15", { vendas: 5, agendamentos: 8 })]);
    expect(h.type === "chart" && h.form).toBe("columns");
  });
});

describe("análises do resultado", () => {
  it("seguidores: estabilidade com menos alcance, sem falar de vendas", () => {
    const a = resultAnalysis({
      ...ctx({ kind: "seguidores", cur: { ...nada, seguidores: 1251 }, media: baitaMedia, prevMedia: baitaPrev, followersGain: 37, prevFollowersTotal: 1214 }),
      attribution: { informadas: null, comOrigem: 0, coberturaPct: null, porFonte: {} },
      topCreative: { name: "Adconheça a Baita", clicks: 90, conversations: 0, spend: 17.35 },
    });
    expect(a.headline).toBe("+37 seguidores na semana.");
    expect(a.insights).toContain("Mesmo com alcance 17% menor, as visitas ao perfil ficaram próximas da semana anterior.");
    expect(a.insights.join(" ")).not.toMatch(/venda|receita|agendamento/i);
  });

  it("vendas: conversão, origem e custo por venda", () => {
    const a = resultAnalysis({
      ...ctx({ cur: { ...nada, vendas: 5, agendamentos: 8, receita: 4100 } }),
      attribution: { informadas: 5, comOrigem: 3, coberturaPct: 60, porFonte: { "1": { vendas: 2, receita: 2000 }, "2": { vendas: 1, receita: 900 } } },
      topCreative: null,
    });
    expect(a.insights).toContain("62,5% dos agendamentos viraram venda.");
    expect(a.insights).toContain("A fonte #1 trouxe 2 das 3 vendas com origem (R$ 2.000,00).");
  });
});

describe("costLadder", () => {
  it("só as etapas que existem", () => {
    expect(costLadder(184.78, 23, { ...nada, vendas: 5 }).map((s) => s.label)).toEqual(["por conversa", "por venda"]);
  });
});
