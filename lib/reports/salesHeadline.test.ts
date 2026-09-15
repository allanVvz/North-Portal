import { describe, expect, it } from "vitest";
import { salesHeadline } from "./salesHeadline";

// ` ` é o espaço estreito que o Intl pt-BR põe depois de "R$".
describe("salesHeadline", () => {
  it("alta: cada percentual colado na sua métrica", () => {
    expect(salesHeadline({ receita: 4100, vendas: 5, agendamentos: 8, prev: { receita: 3200, vendas: 4 } }))
      .toBe("Semana de alta — R$ 4.100,00 em receita (+28%) e 5 vendas fechadas (+25%).");
  });

  it("queda: tom segue a receita", () => {
    expect(salesHeadline({ receita: 2400, vendas: 3, agendamentos: 6, prev: { receita: 4100, vendas: 5 } }))
      .toBe("Semana de queda — R$ 2.400,00 em receita (−41%) e 3 vendas fechadas (−40%).");
  });

  it("estável: variação dentro do limiar não vira 'alta'", () => {
    expect(salesHeadline({ receita: 4200, vendas: 5, agendamentos: 8, prev: { receita: 4100, vendas: 5 } }))
      .toBe("Semana estável — R$ 4.200,00 em receita (+2%) e 5 vendas fechadas (+0%).");
  });

  it("sem semana anterior: nenhuma comparação inventada", () => {
    expect(salesHeadline({ receita: 4100, vendas: 5, agendamentos: 8, prev: null }))
      .toBe("R$ 4.100,00 em receita e 5 vendas fechadas.");
  });

  // --- ausência ≠ zero -------------------------------------------------------

  it("só seguidores informados: fala de audiência, não de vendas zeradas", () => {
    expect(salesHeadline({ receita: null, vendas: null, agendamentos: null, seguidoresGanho: 12, prev: null }))
      .toBe("Semana de audiência — 12 seguidores novos.");
  });

  it("agendamentos sem vendas informadas: diz que vendas não foram informadas", () => {
    expect(salesHeadline({ receita: null, vendas: null, agendamentos: 8, prev: null }))
      .toBe("8 agendamentos em aberto — vendas não informadas nesta semana.");
  });

  it("nada informado: não afirma resultado nenhum", () => {
    expect(salesHeadline({ receita: null, vendas: null, agendamentos: null, prev: null }))
      .toBe("Sem números comerciais informados nesta semana.");
  });

  // Zero DITO pelo gestor é uma observação válida e a frase pode afirmá-la.
  it("zero informado é diferente de não informado", () => {
    expect(salesHeadline({ receita: 0, vendas: 0, agendamentos: 8, prev: { receita: 3200, vendas: 4 } }))
      .toBe("Semana sem vendas fechadas — 8 agendamentos em aberto.");
  });

  it("vendas sem receita: compara venda com venda", () => {
    expect(salesHeadline({ receita: null, vendas: 6, agendamentos: 9, prev: { receita: 4100, vendas: 4 } }))
      .toBe("Semana de alta — 6 vendas fechadas (+50%).");
  });

  it("singular: uma venda não vira 'vendas'", () => {
    expect(salesHeadline({ receita: null, vendas: 1, agendamentos: 1, prev: null }))
      .toBe("1 venda fechada.");
  });
});
