import { describe, expect, it } from "vitest";

import { initialsOf } from "../app/avatar/initials";
import { buildPhotoIndex, findAuthorPhoto, photoKey } from "../app/avatar/photoKey";

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

describe("chave de nome", () => {
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

// A foto do autor de um comentário resolve em duas etapas — id primeiro, nome
// como rede de segurança — porque comentário antigo e comentário de automação
// não têm id. Ver a ressalva em app/avatar/README.md.
describe("foto do autor de um comentário", () => {
  const team = [
    { id: "id-allan", full_name: "Allan Silva", avatar_url: "https://cdn/allan.jpg" },
    { id: "id-cintia", full_name: "Cintia Ferreira", avatar_url: "https://cdn/cintia.jpg" },
    { id: "id-luiza", full_name: "Luiza Prado", avatar_url: null },
  ];
  const index = buildPhotoIndex(team);

  it("resolve por id quando o comentário tem author_id", () => {
    expect(findAuthorPhoto(index, { author: "Allan Silva", author_id: "id-allan" })).toBe("https://cdn/allan.jpg");
  });

  it("prefere o id ao nome — perfil renomeado depois do comentário", () => {
    // O comentário guarda o nome de quando foi escrito; o perfil hoje é outro.
    // Sem id isso cairia nas iniciais; com id, acha a foto certa.
    expect(findAuthorPhoto(index, { author: "Allan Ulisses", author_id: "id-allan" })).toBe("https://cdn/allan.jpg");
  });

  it("não confunde homônimos quando há id", () => {
    expect(findAuthorPhoto(index, { author: "Allan Silva", author_id: "id-cintia" })).toBe("https://cdn/cintia.jpg");
  });

  it("cai no nome quando o comentário é antigo e não tem id", () => {
    expect(findAuthorPhoto(index, { author: "Cintia Ferreira" })).toBe("https://cdn/cintia.jpg");
  });

  it("cai no nome quando o id não está mais no índice — conta apagada", () => {
    expect(findAuthorPhoto(index, { author: "Cintia Ferreira", author_id: "id-que-sumiu" })).toBe("https://cdn/cintia.jpg");
  });

  it("devolve null para automação — a tela mostra as iniciais", () => {
    expect(findAuthorPhoto(index, { author: "Automação" })).toBeNull();
  });

  it("devolve null para quem está na equipe mas não subiu foto", () => {
    expect(findAuthorPhoto(index, { author: "Luiza Prado", author_id: "id-luiza" })).toBeNull();
  });

  it("índice vazio nunca quebra", () => {
    expect(findAuthorPhoto(buildPhotoIndex([]), { author: "Allan Silva", author_id: "id-allan" })).toBeNull();
  });
});
