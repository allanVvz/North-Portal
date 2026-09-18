import { describe, expect, it } from "vitest";
import { createCommentIdRegistry } from "./commentIds";

function registry() {
  let counter = 0;
  return createCommentIdRegistry(() => `id-${(counter += 1)}`);
}

describe("createCommentIdRegistry — chave idempotente do comentário pendente", () => {
  it("o mesmo texto no mesmo card reusa o id enquanto o envio não deu certo (retry / clique duplo)", () => {
    const ids = registry();
    expect(ids.idFor("etapa-1", "está aprovado")).toBe(ids.idFor("etapa-1", "está aprovado"));
  });

  it("depois de um envio bem-sucedido, o mesmo texto é um comentário NOVO", () => {
    const ids = registry();
    const first = ids.idFor("etapa-1", "ok");
    ids.settle("etapa-1", "ok");
    expect(ids.idFor("etapa-1", "ok")).not.toBe(first);
  });

  it("texto ou card diferentes têm ids diferentes", () => {
    const ids = registry();
    const base = ids.idFor("etapa-1", "ok");
    expect(ids.idFor("etapa-1", "ok!")).not.toBe(base);
    expect(ids.idFor("etapa-2", "ok")).not.toBe(base);
  });

  it("falha mantém o id: o reenvio chega ao servidor com a mesma chave", () => {
    const ids = registry();
    const first = ids.idFor("etapa-1", "ajuste a capa");
    // (a requisição falhou; a UI não chama settle)
    expect(ids.idFor("etapa-1", "ajuste a capa")).toBe(first);
  });
});
