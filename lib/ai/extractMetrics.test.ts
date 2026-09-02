import { describe, expect, it } from "vitest";
import { extractMetrics, parseMetricJson } from "./extractMetrics";

const TAGS = ["vendas", "agendamentos", "seguidores", "receita"];

describe("parseMetricJson", () => {
  it("lê um número por tag e zera as ausentes", () => {
    const r = parseMetricJson('{"valores":{"vendas":3,"receita":1400},"linhas":[]}', TAGS);
    expect(r.valores).toEqual({ vendas: 3, agendamentos: 0, seguidores: 0, receita: 1400 });
    expect(r.note).toBe("llm");
  });

  it("lê as linhas ricas quando presentes", () => {
    const r = parseMetricJson(
      'blá {"valores":{"vendas":1,"agendamentos":0,"seguidores":0,"receita":1400},"linhas":[{"servico":"Vitrificação","valor":1400,"fonte":"2","status":"fechado"}]} fim',
      TAGS,
    );
    expect(r.linhas).toEqual([{ servico: "Vitrificação", valor: 1400, fonte: "2", status: "fechado" }]);
  });

  it("resposta sem número → nada identificado, tudo zero", () => {
    const r = parseMetricJson('{"valores":{"vendas":0,"agendamentos":0,"seguidores":0,"receita":0},"linhas":[]}', TAGS);
    expect(Object.values(r.valores).every((v) => v === 0)).toBe(true);
    expect(r.note).toBe("nada identificado");
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
});

describe("extractMetrics", () => {
  it("texto vazio → zeros, não chama a IA", async () => {
    const r = await extractMetrics("   ", TAGS);
    expect(r).toEqual({ valores: { vendas: 0, agendamentos: 0, seguidores: 0, receita: 0 }, linhas: [], note: "comentário vazio" });
  });

  it("'12 agendamentos' → regex, sem IA", async () => {
    const r = await extractMetrics("fechamos 12 agendamentos", TAGS);
    expect(r.valores.agendamentos).toBe(12);
    expect(r.note).toBe("regex");
  });

  it("degrada graciosamente sem provedor de IA (nem AI_CLI)", async () => {
    // Sem AI_CLI e sem credencial 'ai' no banco de teste, aiComplete lança e
    // extractMetrics devolve zeros com note.
    const r = await extractMetrics("semana boa, umas 3 vendas e 45 seguidores", TAGS);
    if (r.note.startsWith("IA indisponível")) {
      expect(Object.values(r.valores).every((v) => v === 0)).toBe(true);
    } else {
      // Se AI_CLI estiver ligado no ambiente, a extração real deve pegar algo.
      expect(r.valores.seguidores).toBeGreaterThan(0);
    }
  });

  it.skipIf(process.env.AI_CLI !== "1")("extração real pela CLI claude", async () => {
    const r = await extractMetrics(
      "Semana boa! Fechamos 3 vendas, uma de R$1.400 veio pela fonte #2. Ganhamos uns 45 seguidores novos, nenhum agendamento.",
      TAGS,
    );
    expect(r.valores.vendas).toBe(3);
    expect(r.valores.seguidores).toBe(45);
    expect(r.valores.agendamentos).toBe(0);
    expect(r.valores.receita).toBeGreaterThanOrEqual(1400);
    expect(r.linhas.some((l) => l.fonte === "2" && l.status === "fechado")).toBe(true);
  }, 120_000);
});
