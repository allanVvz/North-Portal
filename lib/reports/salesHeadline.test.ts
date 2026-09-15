import { describe, expect, it } from "vitest";
import { salesHeadline } from "./salesHeadline";

describe("salesHeadline", () => {
  it("alta: receita acima da semana anterior", () => {
    expect(salesHeadline({ receita: 4100, vendas: 5, agendamentos: 8, prev: { receita: 3200, vendas: 4 } }))
      .toBe("Semana de alta — R$ 4.100,00 em receita e 5 vendas fechadas (+28% vs. a semana anterior).");
  });

  it("queda: receita abaixo da semana anterior", () => {
    expect(salesHeadline({ receita: 2400, vendas: 3, agendamentos: 6, prev: { receita: 4100, vendas: 5 } }))
      .toBe("Semana de queda — R$ 2.400,00 em receita e 3 vendas fechadas (−41% vs. a semana anterior).");
  });

  it("estável: variação dentro do limiar não vira 'alta'", () => {
    expect(salesHeadline({ receita: 4200, vendas: 5, agendamentos: 8, prev: { receita: 4100, vendas: 5 } }))
      .toBe("Semana estável — R$ 4.200,00 em receita e 5 vendas fechadas (+2% vs. a semana anterior).");
  });

  it("sem semana anterior na série: nenhuma comparação inventada", () => {
    expect(salesHeadline({ receita: 4100, vendas: 5, agendamentos: 8, prev: null }))
      .toBe("Primeira semana com dados — R$ 4.100,00 em receita e 5 vendas fechadas.");
  });

  // O comparativo segue a grandeza que aparece na frase: sem receita, quem manda
  // é venda — comparar com a receita anterior diria "queda" sobre um número que
  // a frase nem mostra.
  it("sem receita relatada: compara vendas com vendas", () => {
    expect(salesHeadline({ receita: 0, vendas: 6, agendamentos: 9, prev: { receita: 4100, vendas: 4 } }))
      .toBe("Semana de alta — 6 vendas fechadas (+50% vs. a semana anterior).");
  });

  it("sem venda nenhuma: fala dos agendamentos em aberto", () => {
    expect(salesHeadline({ receita: 0, vendas: 0, agendamentos: 8, prev: { receita: 3200, vendas: 4 } }))
      .toBe("Semana sem vendas fechadas — 8 agendamentos em aberto.");
  });

  it("semana vazia: diz isso de frente, sem frase de resultado com zeros", () => {
    expect(salesHeadline({ receita: 0, vendas: 0, agendamentos: 0, prev: null }))
      .toBe("Semana sem vendas ou agendamentos registrados.");
  });

  it("singular: uma venda não vira 'vendas'", () => {
    expect(salesHeadline({ receita: 0, vendas: 1, agendamentos: 1, prev: null }))
      .toBe("Primeira semana com dados — 1 venda fechada.");
  });
});
