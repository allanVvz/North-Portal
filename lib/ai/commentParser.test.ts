import { describe, expect, it } from "vitest";
import { feedbackTemplate, parseAmount, parseFeedbackComment } from "./commentParser";

const TAGS = ["vendas", "agendamentos", "seguidores", "receita"];

describe("parseFeedbackComment — o modelo", () => {
  it("o modelo do pedido é lido inteiro, com as linhas de origem", () => {
    const r = parseFeedbackComment(feedbackTemplate(TAGS), TAGS);
    expect(r.state).toBe("PARSED_OK");
    expect(r.valores).toEqual({ vendas: 5, agendamentos: 8, seguidores: 841, receita: 4100 });
    expect(r.linhas).toEqual([
      { servico: "PPF frontal", valor: 1200, fonte: "1", status: "fechado" },
      { servico: "Higienização interna", valor: 900, fonte: "2", status: "fechado" },
    ]);
    expect(r.problemas).toEqual([]);
  });

  it("só seguidores: PARTIAL, o resto fica não informado", () => {
    const r = parseFeedbackComment("Seguidores: 1.251", TAGS);
    expect(r.state).toBe("PARTIAL");
    expect(r.valores).toEqual({ vendas: null, agendamentos: null, seguidores: 1251, receita: null });
  });

  it("fora de ordem e com centavos", () => {
    const r = parseFeedbackComment("Seguidores 841\nReceita R$ 4.100,50\nVendas: 5", TAGS);
    expect(r.valores).toMatchObject({ vendas: 5, seguidores: 841, receita: 4100.5 });
  });

  it("linha de origem sem R$ e sem linha de receita: a receita é a soma", () => {
    const r = parseFeedbackComment("Vendas: 2\n#1 PPF R$ 1.200\n#2 Polimento 900", TAGS);
    expect(r.valores.receita).toBe(2100);
    expect(r.linhas[1]).toEqual({ servico: "Polimento", valor: 900, fonte: "2", status: "fechado" });
  });

  it("linha de origem agendada não entra na soma da receita", () => {
    const r = parseFeedbackComment("#1 PPF R$ 1.200\n#2 Vitrificação R$ 800 agendado", TAGS);
    expect(r.linhas[1].status).toBe("agendado");
    expect(r.valores.receita).toBe(1200);
  });

  it("sem métrica de venda pedida, linha de origem é ignorada", () => {
    const r = parseFeedbackComment("Seguidores: 841\n#1 PPF R$ 1.200", ["seguidores"]);
    expect(r.linhas).toEqual([]);
    expect(r.state).toBe("PARSED_OK");
  });
});

describe("parseFeedbackComment — texto natural", () => {
  it("frase curta", () => {
    const r = parseFeedbackComment("semana boa, umas 3 vendas e 45 seguidores", TAGS);
    expect(r.valores).toMatchObject({ vendas: 3, seguidores: 45 });
  });

  it("rótulo-número e número-rótulo na mesma linha não trocam os valores", () => {
    expect(parseFeedbackComment("Vendas 5 Agendamentos 8", TAGS).valores).toMatchObject({ vendas: 5, agendamentos: 8 });
    expect(parseFeedbackComment("5 vendas 8 agendamentos", TAGS).valores).toMatchObject({ vendas: 5, agendamentos: 8 });
  });

  it("zero dito é 0, não ausência", () => {
    const r = parseFeedbackComment("nenhuma venda essa semana, 12 agendamentos", TAGS);
    expect(r.valores).toMatchObject({ vendas: 0, agendamentos: 12, receita: null });
  });

  it("orçamento conta como agendamento", () => {
    expect(parseFeedbackComment("3 orçamentos enviados", TAGS).valores.agendamentos).toBe(3);
  });

  it("seguidores de X para Y é o total Y", () => {
    const first = parseFeedbackComment("seguidores de 829 pra 841", TAGS);
    expect(first.valores.seguidores).toBe(841);
    expect(first.valoresAnteriores.seguidores).toBe(829);
    const second = parseFeedbackComment("foi de 829 para 841 seguidores", TAGS);
    expect(second.valores.seguidores).toBe(841);
    expect(second.valoresAnteriores.seguidores).toBe(829);
  });

  it("ganho de seguidores não vira total", () => {
    const r = parseFeedbackComment("Vendas: 2, ganhamos 17 seguidores", TAGS);
    expect(r.valores.seguidores).toBeNull();
    expect(r.precisaIa).toBe(true);
    expect(r.problemas.join()).toContain("ganho");
  });

  it("agendamento nunca abaixo de venda", () => {
    expect(parseFeedbackComment("Vendas: 6\nAgendamentos: 2", TAGS).valores.agendamentos).toBe(6);
  });
});

describe("parseFeedbackComment — o que não lê", () => {
  it("mesma métrica com dois valores: AMBIGUOUS e fica de fora", () => {
    const r = parseFeedbackComment("Vendas: 5\nVendas: 6", TAGS);
    expect(r.state).toBe("AMBIGUOUS");
    expect(r.valores.vendas).toBeNull();
  });

  it("nada reconhecível: INVALID", () => {
    expect(parseFeedbackComment("semana foi boa, cliente gostou", TAGS).state).toBe("INVALID");
  });

  it("número sem rótulo não vira métrica e é avisado", () => {
    const r = parseFeedbackComment("Vendas: 5\nsemana 37", TAGS);
    expect(r.state).toBe("PARTIAL");
    expect(r.problemas).toHaveLength(1);
  });

  it("origem no meio da frase pede leitura natural", () => {
    const r = parseFeedbackComment("3 vendas, uma de R$1.400 pela #2", TAGS);
    expect(r.valores.vendas).toBe(3);
    expect(r.precisaIa).toBe(true);
  });
});

describe("parseAmount", () => {
  it("formatos de número", () => {
    expect(parseAmount("4.100")).toBe(4100);
    expect(parseAmount("4.100,50")).toBe(4100.5);
    expect(parseAmount("4100.50")).toBe(4100.5);
    expect(parseAmount("841")).toBe(841);
  });
});
