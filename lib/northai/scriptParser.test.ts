import { describe, expect, it } from "vitest";
import { parseScripts } from "./scriptParser";

describe("parseScripts", () => {
  it("separa pelos títulos com a palavra do conteúdo e detecta o formato", () => {
    const doc = [
      "Diária Tock Fatal — 22/09",
      "",
      "ROTEIRO 1 — REELS",
      "1. Gancho: você sabia que o corte certo muda o rosto?",
      "2. Desenvolvimento: antes e depois com a Ana.",
      "3. CTA: agende pelo link.",
      "",
      "Roteiro 2: Carrossel dicas de cuidado",
      "Slide 1 — capa. Slide 2 — hidratação.",
      "",
      "## Roteiro 3",
      "Story de bastidores da gravação.",
    ].join("\n");

    const pieces = parseScripts(doc);
    expect(pieces.map((piece) => piece.title)).toEqual(["ROTEIRO 1 — REELS", "Roteiro 2: Carrossel dicas de cuidado", "Roteiro 3"]);
    expect(pieces.map((piece) => piece.format)).toEqual(["reels", "carrossel", "story"]);
    // As seções numeradas do padrão North ficam dentro do roteiro, não viram peças.
    expect(pieces[0].body).toContain("Gancho");
    expect(pieces[0].body).toContain("CTA");
  });

  it("usa separadores de linha quando não há títulos", () => {
    const pieces = parseScripts("Antes e depois\ntexto um\n---\nBanner da promoção\ntexto dois\n---\nDepoimento\ntexto três");
    expect(pieces).toHaveLength(3);
    expect(pieces[1]).toMatchObject({ title: "Banner da promoção", format: "banner", formatDetected: true });
    expect(pieces[2]).toMatchObject({ title: "Depoimento", format: "reels", formatDetected: false });
  });

  it("usa numeração curta quando não é seção do roteiro", () => {
    const pieces = parseScripts("1. Antes e depois\nfala da cliente\n2. Três erros no cabelo\nlista\n3. Bastidores\nstory rápido");
    expect(pieces.map((piece) => piece.title)).toEqual(["Antes e depois", "Três erros no cabelo", "Bastidores"]);
    expect(pieces[2].format).toBe("story");
  });

  it("um documento sem divisões é uma peça só, e texto vazio não gera nada", () => {
    expect(parseScripts("Um vídeo só\n1. Gancho: oi\n2. CTA: tchau")).toHaveLength(1);
    expect(parseScripts("   ")).toEqual([]);
  });
});
