import { describe, expect, it } from "vitest";
import { assigneeOptions, formatAssignees, freeTextNames, mergeAssigneeDisplay, parseAssignees } from "./assignees";

describe("responsáveis múltiplos", () => {
  it("normaliza, remove duplicados e preserva nomes reutilizáveis", () => {
    expect(parseAssignees("Ana, Bruno, ana,  Carla ")).toEqual(["Ana", "Bruno", "Carla"]);
    expect(formatAssignees(["Ana", "Bruno", "Ana"])).toBe("Ana, Bruno");
    expect(assigneeOptions(["Bruno, Ana", "Carla", "Ana"])).toEqual(["Ana", "Bruno", "Carla"]);
  });
});

describe("mergeAssigneeDisplay", () => {
  it("combina texto livre remanescente com nomes de contas vinculadas", () => {
    expect(mergeAssigneeDisplay("Fulano freelancer", ["Allan", "Cintia"])).toBe("Fulano freelancer, Allan, Cintia");
  });

  it("dedupe quando o nome já existe nos dois lados", () => {
    expect(mergeAssigneeDisplay("Allan, Bruno", ["Allan"])).toBe("Allan, Bruno");
  });

  it("ignora entradas vazias/nulas na lista de contas", () => {
    expect(mergeAssigneeDisplay("Ana", [null, undefined, "  "])).toBe("Ana");
  });

  it("retorna null quando não há nenhum nome dos dois lados", () => {
    expect(mergeAssigneeDisplay(null, [])).toBeNull();
    expect(mergeAssigneeDisplay("", [null])).toBeNull();
  });

  it("funciona só com contas vinculadas, sem texto livre", () => {
    expect(mergeAssigneeDisplay(null, ["Luiza", "Alisson"])).toBe("Luiza, Alisson");
  });
});

describe("freeTextNames", () => {
  // Reprodução do bug: raw assignee = "Cintia, Luiza" (texto de antes de
  // vincular conta) + as duas já vinculadas — o picker não pode mostrar as
  // duas de novo como "sem conta".
  it("bug reproduzido: nada sobra quando as duas contas cobrem os dois nomes", () => {
    expect(freeTextNames("Cintia, Luiza", ["Cintia", "Luiza"])).toEqual([]);
  });

  it("mantém só quem não tem conta vinculada, sem depender de acento/maiúscula", () => {
    expect(freeTextNames("Cintia, Fulano freelancer, LUIZA", ["Cintia", "Luiza"])).toEqual(["Fulano freelancer"]);
  });

  it("sem sobreposição, devolve tudo; sem nada, devolve lista vazia", () => {
    expect(freeTextNames("Fulano, Beltrano", ["Cintia"])).toEqual(["Fulano", "Beltrano"]);
    expect(freeTextNames(null, ["Cintia"])).toEqual([]);
    expect(freeTextNames("", [])).toEqual([]);
  });
});
