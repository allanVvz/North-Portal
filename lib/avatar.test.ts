import { describe, expect, it } from "vitest";

import { initialsOf } from "../app/avatar/initials";
import { photoKey } from "../app/avatar/photoKey";

// A regra de iniciais é a mesma em cinco telas (ver app/avatar/README.md).
// Antes eram três regras diferentes, e a divergência só aparecia comparando
// duas telas lado a lado — o tipo de coisa que ninguém nota até alguém
// reclamar que "meu ícone está diferente aqui".
describe("iniciais", () => {
  it("usa primeiro + último nome", () => {
    expect(initialsOf("Allan Ulisses Silva")).toBe("AS");
    expect(initialsOf("Cintia Ferreira")).toBe("CF");
  });

  it("dobra a letra quando só há um nome", () => {
    expect(initialsOf("Luiza")).toBe("LU");
  });

  it("não quebra com nome vazio, nulo ou só espaço", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf(null)).toBe("?");
    expect(initialsOf(undefined)).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("ignora espaço sobrando no meio e nas pontas", () => {
    expect(initialsOf("  Allan   Silva  ")).toBe("AS");
  });
});

// A foto do autor de um comentário é procurada pelo nome, porque o comentário
// grava o autor como texto e não como id (ver a ressalva no README). A chave
// precisa ser tolerante a caixa e espaço, senão "Allan Silva" gravado num
// comentário não casa com "allan silva " vindo do perfil.
describe("chave de busca da foto por nome", () => {
  it("normaliza caixa e espaço nas pontas", () => {
    expect(photoKey("  Allan Silva ")).toBe(photoKey("allan silva"));
    expect(photoKey("CINTIA")).toBe(photoKey("cintia"));
  });

  it("trata nome ausente como chave vazia", () => {
    expect(photoKey(null)).toBe("");
    expect(photoKey(undefined)).toBe("");
  });

  it("não confunde pessoas diferentes", () => {
    expect(photoKey("Allan Silva")).not.toBe(photoKey("Allan Souza"));
  });
});
