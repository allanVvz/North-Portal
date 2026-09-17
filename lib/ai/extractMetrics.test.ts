import { describe, expect, it, vi } from "vitest";
import { extractMetrics, parseMetricJson } from "./extractMetrics";

const TAGS = ["vendas", "agendamentos", "seguidores", "receita"];

describe("parseMetricJson", () => {
  // A regra central do módulo: `null` é "o gestor não falou disso"; `0` é "ele
  // falou e foi zero". Confundir os dois faz o relatório afirmar um resultado
  // ruim que ninguém relatou, e — desde que task_metrics virou série — envenena
  // a comparação da semana seguinte.
  it("tag ausente vira null, não 0", () => {
    const r = parseMetricJson('{"valores":{"vendas":3,"receita":1400},"linhas":[]}', TAGS);
    expect(r.valores).toEqual({ vendas: 3, agendamentos: null, seguidores: null, receita: 1400 });
    expect(r.note).toBe("llm");
  });

  it("zero DITO é preservado como 0", () => {
    const r = parseMetricJson('{"valores":{"vendas":0,"agendamentos":4},"linhas":[]}', TAGS);
    expect(r.valores.vendas).toBe(0);
    expect(r.valores.agendamentos).toBe(4);
  });

  it("lê as linhas ricas quando presentes", () => {
    const r = parseMetricJson(
      'blá {"valores":{"vendas":1,"agendamentos":0,"seguidores":0,"receita":1400},"linhas":[{"servico":"Vitrificação","valor":1400,"fonte":"2","status":"fechado"}]} fim',
      TAGS,
    );
    expect(r.linhas).toEqual([{ servico: "Vitrificação", valor: 1400, fonte: "2", status: "fechado" }]);
  });

  it("resposta sem nenhuma chave → nada identificado, tudo null", () => {
    const r = parseMetricJson('{"valores":{},"linhas":[]}', TAGS);
    expect(Object.values(r.valores).every((v) => v === null)).toBe(true);
    expect(r.note).toBe("nada identificado");
  });

  it("zeros ditos contam como informação identificada", () => {
    const r = parseMetricJson('{"valores":{"vendas":0,"agendamentos":0},"linhas":[]}', TAGS);
    expect(r.note).toBe("llm");
  });

  it("JSON ilegível → zeros + note", () => {
    expect(parseMetricJson("não é json", TAGS).note).toBe("resposta da IA ilegível");
  });

  it("tag fora do catálogo funciona igual", () => {
    const r = parseMetricJson('{"valores":{"leads":7}}', ["leads"]);
    expect(r.valores).toEqual({ leads: 7 });
  });

  it("valor com R$ e milhar vira número puro", () => {
    const r = parseMetricJson('{"valores":{"receita":"R$ 1.400,50"}}', ["receita"]);
    expect(r.valores.receita).toBeCloseTo(1400.5);
  });

  it("receita não informada mas linhas detalhadas → soma das linhas vira o total", () => {
    const r = parseMetricJson(
      '{"valores":{"vendas":5,"agendamentos":9,"seguidores":35},"linhas":[{"servico":null,"valor":2400,"fonte":"1","status":"fechado"},{"servico":null,"valor":1800,"fonte":"3","status":"fechado"}]}',
      TAGS,
    );
    expect(r.valores.receita).toBe(4200);
  });

  it("vendas sem agendamentos informados: não inventa agendamento", () => {
    const r = parseMetricJson('{"valores":{"vendas":5}}', TAGS);
    expect(r.valores.agendamentos).toBeNull();
  });

  it("agendamentos nunca fica abaixo de vendas", () => {
    const r = parseMetricJson(
      '{"valores":{"vendas":6,"agendamentos":0,"seguidores":0,"receita":6800},"linhas":[]}',
      TAGS,
    );
    expect(r.valores.agendamentos).toBe(6);
  });

  it("total de receita declarado vence a soma das linhas", () => {
    const r = parseMetricJson(
      '{"valores":{"vendas":3,"agendamentos":0,"seguidores":0,"receita":10000},"linhas":[{"servico":null,"valor":1400,"fonte":"2","status":"fechado"}]}',
      TAGS,
    );
    expect(r.valores.receita).toBe(10000);
  });
});

describe("extractMetrics", () => {
  it("texto vazio → tudo null, não chama a IA", async () => {
    const r = await extractMetrics("   ", TAGS);
    expect(r).toEqual({ valores: { vendas: null, agendamentos: null, seguidores: null, receita: null }, linhas: [], note: "comentário vazio" });
  });

  it("'12 agendamentos' → parser, sem IA", async () => {
    const r = await extractMetrics("fechamos 12 agendamentos", TAGS);
    expect(r.valores.agendamentos).toBe(12);
    expect(r.note).toBe("parser");
  });

  it.skipIf(process.env.COMMENT_AI_FALLBACK === "1")("o modelo do pedido é lido pelo parser", async () => {
    const r = await extractMetrics("Vendas: 5\nAgendamentos: 8\nReceita: R$ 4.100\nSeguidores: 841\n#1 PPF frontal R$ 1.200", TAGS);
    expect(r.note).toBe("parser");
    expect(r.valores).toEqual({ vendas: 5, agendamentos: 8, seguidores: 841, receita: 4100 });
    expect(r.linhas).toHaveLength(1);
  });

  it.skipIf(process.env.COMMENT_AI_FALLBACK === "1")("fora do modelo e sem fallback: não chama IA, tudo null", async () => {
    // "Não sabemos" nunca vira "a semana foi zero"; o fluxo responde ao gestor
    // pedindo o modelo em vez de fechar a semana.
    const r = await extractMetrics("semana foi boa, cliente gostou bastante", TAGS);
    expect(r.note).toBe("formato não reconhecido");
    expect(Object.values(r.valores).every((v) => v === null)).toBe(true);
  });

  it.skipIf(process.env.COMMENT_AI_FALLBACK === "1")("AI_CLI não habilita rede nem altera o parser determinístico", async () => {
    const prior = process.env.AI_CLI;
    process.env.AI_CLI = "1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await extractMetrics("semana foi boa, cliente gostou bastante", TAGS);
      expect(r.note).toBe("formato não reconhecido");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.AI_CLI;
      else process.env.AI_CLI = prior;
      vi.unstubAllGlobals();
    }
  });

});
