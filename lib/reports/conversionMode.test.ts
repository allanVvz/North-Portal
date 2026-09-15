import { describe, expect, it } from "vitest";
import { attributionOf, conversionModeOf } from "./conversionMode";
import type { ConversionRow } from "@/lib/ai/extractMetrics";

const nada = { vendas: null, agendamentos: null, receita: null, seguidores: null };
const venda = (fonte: ConversionRow["fonte"], valor: number | null = null, status: ConversionRow["status"] = "fechado"): ConversionRow =>
  ({ servico: null, valor, fonte, status });

describe("conversionModeOf", () => {
  it("só seguidores → followers_only", () => {
    expect(conversionModeOf({ ...nada, seguidores: 841 }, [])).toBe("followers_only");
  });

  it("vendas e agendamentos sem origem → sales_summary", () => {
    expect(conversionModeOf({ ...nada, vendas: 5, agendamentos: 8 }, [])).toBe("sales_summary");
  });

  it("com origem #1/#2 → sales_segmented", () => {
    expect(conversionModeOf({ ...nada, vendas: 5 }, [venda("1"), venda("2")])).toBe("sales_segmented");
  });

  it("nada informado → no_data, nunca um modo de vendas com zeros", () => {
    expect(conversionModeOf(nada, [])).toBe("no_data");
  });

  // Zero dito é informação: "não vendemos nada" é um relatório de vendas.
  it("vendas = 0 informado ainda é sales_summary", () => {
    expect(conversionModeOf({ ...nada, vendas: 0 }, [])).toBe("sales_summary");
  });
});

describe("attributionOf", () => {
  it("5 vendas, #1 #1 #2 → 3 atribuídas, cobertura 60%, sem inventar as outras 2", () => {
    const a = attributionOf(5, [venda("1", 1200), venda("1", 800), venda("2", 900)]);
    expect(a.comOrigem).toBe(3);
    expect(a.coberturaPct).toBe(60);
    expect(a.porFonte).toEqual({ "1": { vendas: 2, receita: 2000 }, "2": { vendas: 1, receita: 900 } });
  });

  it("vendas sem nenhuma origem → cobertura 0%", () => {
    const a = attributionOf(5, []);
    expect(a.comOrigem).toBe(0);
    expect(a.coberturaPct).toBe(0);
  });

  it("origem sem valor → vendas contadas, receita por origem null (não 0)", () => {
    const a = attributionOf(2, [venda("1"), venda("1")]);
    expect(a.porFonte["1"]).toEqual({ vendas: 2, receita: null });
  });

  it("agendamento com origem não conta como venda atribuída", () => {
    const a = attributionOf(1, [venda("1", 500), venda("2", null, "agendado")]);
    expect(a.comOrigem).toBe(1);
    expect(a.porFonte["2"]).toBeUndefined();
  });

  it("mais linhas com origem do que o total declarado → o total manda", () => {
    const a = attributionOf(2, [venda("1"), venda("2"), venda("3")]);
    expect(a.comOrigem).toBe(2);
    expect(a.coberturaPct).toBe(100);
  });

  it("vendas não informadas → cobertura indefinida", () => {
    const a = attributionOf(null, [venda("1", 700)]);
    expect(a.informadas).toBeNull();
    expect(a.coberturaPct).toBeNull();
  });
});
