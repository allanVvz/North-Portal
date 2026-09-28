import { describe, expect, it, vi } from "vitest";
import { interpretByRules, interpretComment, mergeValidated, numbersInText } from "./interpretComment";
import { CORPUS, mismatches } from "./interpretComment.corpus";

vi.mock("./complete", () => ({ aiComplete: vi.fn(async () => { throw new Error("sem IA no teste"); }) }));

describe("regras sozinhas (IA fora do ar) acertam os comentários reais", () => {
  it.each(CORPUS)("$id", (c) => {
    expect(mismatches(c, interpretByRules(c.text, c.ctx))).toEqual([]);
  });
});

describe("guarda-corpos sobre a resposta da IA", () => {
  const ctx = { step: "feedback" as const, tags: ["vendas", "seguidores"] };
  const empty = { metrics: [], seguidoresNovos: null, seguidoresTotal: null, reachTotal: null, reachByObjective: [], narrative: null, hide: [], visual: null, approval: false, question: null, notUnderstood: [] };

  it("número que não está no texto é descartado", () => {
    const text = "114 novos seguidores";
    const i = mergeValidated({ ...empty, seguidoresNovos: 140, metrics: [{ tag: "vendas", value: 3 }] }, text, ctx, interpretByRules(text, ctx));
    expect(i.seguidoresNovos).toBe(114); // o 140 inventado perdeu para as regras
    expect(i.metrics).toEqual({});
  });

  it("leitura reescrita pela IA é recusada; trecho literal passa", () => {
    const text = "Leitura da semana: foco em público novo em NH e POA.";
    const reescrita = mergeValidated({ ...empty, narrative: "A semana priorizou novos públicos na região metropolitana." }, text, ctx, interpretByRules(text, ctx));
    expect(reescrita.narrative).toBe("foco em público novo em NH e POA."); // das regras
    const literal = mergeValidated({ ...empty, narrative: "foco em público novo em NH e POA" }, text, ctx, interpretByRules(text, ctx));
    expect(literal.narrative).toBe("foco em público novo em NH e POA");
  });

  it("tag que o cliente não acompanha e objetivo fora da lista são ignorados", () => {
    const text = "receita 5000, alcance 800 da campanha de loja";
    const i = mergeValidated({ ...empty, metrics: [{ tag: "receita", value: 5000 }], reachByObjective: [{ objective: "loja", value: 800 }] }, text, ctx, interpretByRules(text, ctx));
    expect(i.metrics).toEqual({});
    expect(i.reach.byObjective).toEqual({});
  });

  it("IA acrescenta o que as regras não viram, com número do texto", () => {
    const text = "fechamos 3 vendas na semana";
    const i = mergeValidated({ ...empty, metrics: [{ tag: "vendas", value: 3 }] }, text, ctx, interpretByRules(text, ctx));
    expect(i.metrics).toEqual({ vendas: 3 });
    expect(i.useful).toBe(true);
  });

  it("corrigir um número não é esconder: 'esconder alcance' sem pedido de remoção é recusado", () => {
    const text = "alcance corrigir para 12.452. Não incluir numero de compras";
    const i = mergeValidated({ ...empty, hide: ["alcance", "compras"], reachTotal: 12452 }, text, ctx, interpretByRules(text, ctx));
    expect(i.hide).toEqual(["compras"]);
    expect(i.reach.total).toBe(12452);
  });

  it("lê números como estão escritos em pt-BR", () => {
    expect([...numbersInText("alcance 12.452, seguidores 30,9 mil, custo R$ 1.200,50")]).toEqual(expect.arrayContaining([12452, 30900, 1200.5]));
  });
});

describe("interpretComment", () => {
  it("sem IA devolve o resultado das regras, sem lançar", async () => {
    const i = await interpretComment("seguidores novos:39", { step: "feedback", tags: ["seguidores"] });
    expect(i).toMatchObject({ seguidoresNovos: 39, useful: true, source: "regras" });
  });

  it("usa a IA quando ela responde JSON válido", async () => {
    const complete = vi.fn(async () => JSON.stringify({ metrics: [{ tag: "vendas", value: 2 }], seguidoresNovos: null, seguidoresTotal: null, reachTotal: null, reachByObjective: [], narrative: null, hide: [], visual: null, approval: false, question: null, notUnderstood: [] }));
    const i = await interpretComment("vendemos 2 kits de PPF", { step: "feedback", tags: ["vendas"] }, { complete });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ jsonSchema: expect.objectContaining({ name: "team_comment_intent" }) }));
    expect(i).toMatchObject({ metrics: { vendas: 2 }, source: "ia+regras" });
  });
});
