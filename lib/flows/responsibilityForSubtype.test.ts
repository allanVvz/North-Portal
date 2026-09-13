import { describe, expect, it } from "vitest";
import { responsibilityForSubtype } from "./responsibilityForSubtype";

describe("responsibilityForSubtype", () => {
  it("roteiro/captacao/edicao mapeiam para a responsabilidade de mesmo nome", () => {
    expect(responsibilityForSubtype("roteiro")).toBe("roteiro");
    expect(responsibilityForSubtype("captacao")).toBe("captacao");
    expect(responsibilityForSubtype("edicao")).toBe("edicao");
  });

  it("publicacao não tem responsabilidade correspondente", () => {
    expect(responsibilityForSubtype("publicacao")).toBeNull();
  });

  it("subtipo desconhecido, vazio ou ausente: null", () => {
    expect(responsibilityForSubtype("qualquer_coisa")).toBeNull();
    expect(responsibilityForSubtype(null)).toBeNull();
    expect(responsibilityForSubtype(undefined)).toBeNull();
  });
});
