import { describe, expect, it } from "vitest";
import { dailySeries, platformSplit } from "./adsInsights";
import type { MetaPost } from "@/lib/windsor";

// O relatório de anúncios detalha o que a Marketing API entrega. Duas quebras
// estavam nos dados desde sempre e nunca apareciam no PDF: o dia (a consulta usa
// `time_increment: 1`) e a plataforma de veiculação (`breakdowns:
// publisher_platform`). Este arquivo fixa as regras de quando cada quebra vale a
// pena mostrar — e quando mostrar seria ruído.

const PERIOD = { from: "2026-09-14", to: "2026-09-20" };

const post = (over: Partial<MetaPost> & { metrics: MetaPost["metrics"] }): MetaPost => ({
  id: over.id ?? Math.random().toString(36).slice(2), date: "2026-09-14", accountId: "act", accountName: "Conta",
  platform: "instagram", source: "paid", type: "imagem", caption: "", permalink: null, ...over,
});

describe("dailySeries", () => {
  it("um ponto por dia do período, inclusive os dias sem veiculação", () => {
    const posts = [
      post({ date: "2026-09-14", metrics: { custo: 10, profileVisits: 5 } }),
      post({ date: "2026-09-17", metrics: { custo: 20, profileVisits: 9 } }),
    ];
    const series = dailySeries(posts, PERIOD, "visitas");
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ day: "2026-09-14", spend: 10, result: 5 });
    expect(series[3]).toEqual({ day: "2026-09-17", spend: 20, result: 9 });
    // Dia sem verba entra como zero: o buraco no gráfico é informação.
    expect(series[1].spend).toBe(0);
  });

  it("soma as linhas do mesmo dia (uma por campanha × plataforma)", () => {
    const posts = [
      post({ date: "2026-09-15", platform: "instagram", metrics: { custo: 10, profileVisits: 4 } }),
      post({ date: "2026-09-15", platform: "facebook", metrics: { custo: 5, profileVisits: 3 } }),
    ];
    const series = dailySeries(posts, PERIOD, "visitas");
    expect(series[1]).toEqual({ day: "2026-09-15", spend: 15, result: 7 });
  });

  it("semana sem investimento nenhum não vira gráfico de zeros", () => {
    expect(dailySeries([], PERIOD, "visitas")).toEqual([]);
    expect(dailySeries([post({ metrics: { custo: 0 } })], PERIOD, "visitas")).toEqual([]);
  });
});

describe("platformSplit", () => {
  it("rateia investimento e resultado por plataforma, do maior para o menor", () => {
    const rows = platformSplit([
      post({ platform: "facebook", metrics: { custo: 30, contatos: 3 } }),
      post({ platform: "instagram", metrics: { custo: 70, contatos: 14 } }),
    ], "conversas");
    expect(rows.map((r) => r.platform)).toEqual(["instagram", "facebook"]);
    expect(rows[0]).toEqual({ platform: "instagram", spend: 70, result: 14, cost: 5 });
    expect(rows[1].cost).toBe(10);
  });

  it("uma plataforma só não é rateio — é o total, que já está no cabeçalho", () => {
    const rows = platformSplit([post({ platform: "instagram", metrics: { custo: 70, contatos: 14 } })], "conversas");
    expect(rows).toEqual([]);
  });

  it("ignora linhas orgânicas e plataformas sem investimento", () => {
    const rows = platformSplit([
      post({ platform: "instagram", metrics: { custo: 70, contatos: 14 } }),
      post({ platform: "facebook", source: "organic", metrics: { custo: 999, contatos: 99 } }),
      post({ platform: "messenger", metrics: { custo: 0, contatos: 0 } }),
    ], "conversas");
    // Sobra uma paga só → nada a rateiar.
    expect(rows).toEqual([]);
  });

  it("custo por resultado é null quando o resultado é zero, nunca divisão por zero", () => {
    const rows = platformSplit([
      post({ platform: "instagram", metrics: { custo: 70, contatos: 0 } }),
      post({ platform: "facebook", metrics: { custo: 30, contatos: 0 } }),
    ], "conversas");
    expect(rows.every((r) => r.cost === null)).toBe(true);
  });
});
