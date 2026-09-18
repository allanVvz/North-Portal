import { describe, expect, it } from "vitest";
import { deriveRequiresReview, stepSkipsReview } from "./reviewSkip";

describe("stepSkipsReview — revisar o próprio trabalho", () => {
  it("revisor é o único responsável: pula revisão", () => {
    expect(stepSkipsReview("allan", ["allan"])).toBe(true);
  });

  it("revisor está entre VÁRIOS responsáveis: revisão continua valendo", () => {
    expect(stepSkipsReview("allan", ["allan", "cintia"])).toBe(true);
  });

  it("sem revisor: nunca pula", () => {
    expect(stepSkipsReview(null, ["allan"])).toBe(false);
  });

  it("sem nenhum responsável vinculado: nunca pula", () => {
    expect(stepSkipsReview("allan", [])).toBe(false);
  });

  it("revisor diferente do único responsável: revisão continua valendo", () => {
    expect(stepSkipsReview("cintia", ["allan"])).toBe(false);
  });
});

describe("deriveRequiresReview", () => {
  it("sem reviewer_id: nunca exige revisão", () => {
    expect(deriveRequiresReview(null, [])).toBe(false);
    expect(deriveRequiresReview(null, ["allan"])).toBe(false);
  });

  it("com reviewer_id e sem auto-revisão: exige revisão", () => {
    expect(deriveRequiresReview("allan", [])).toBe(true);
    expect(deriveRequiresReview("allan", ["cintia"])).toBe(true);
    expect(deriveRequiresReview("allan", ["cintia", "luiza"])).toBe(true);
  });

  it("com reviewer_id igual ao único responsável: NÃO exige revisão", () => {
    expect(deriveRequiresReview("allan", ["allan"])).toBe(false);
    expect(deriveRequiresReview("allan", ["allan", "luiza"])).toBe(false);
  });
});
