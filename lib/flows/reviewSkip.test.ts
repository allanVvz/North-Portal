import { describe, expect, it } from "vitest";
import { deriveRequiresReview, stepSkipsReview } from "./reviewSkip";

describe("stepSkipsReview — papéis humanos não se misturam", () => {
  it("revisor também responsável continua precisando revisar", () => {
    expect(stepSkipsReview("allan", ["allan"])).toBe(false);
  });

  it("revisor está entre VÁRIOS responsáveis: revisão continua valendo", () => {
    expect(stepSkipsReview("allan", ["allan", "cintia"])).toBe(false);
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

  it("com reviewer_id: exige revisão, inclusive quando também é responsável", () => {
    expect(deriveRequiresReview("allan", [])).toBe(true);
    expect(deriveRequiresReview("allan", ["cintia"])).toBe(true);
    expect(deriveRequiresReview("allan", ["cintia", "luiza"])).toBe(true);
  });

  it("com reviewer_id igual ao responsável continua exigindo revisão", () => {
    expect(deriveRequiresReview("allan", ["allan"])).toBe(true);
    expect(deriveRequiresReview("allan", ["allan", "luiza"])).toBe(true);
  });

  it("North AI estruturada como revisora exige revisão mesmo sem revisor humano", () => {
    expect(deriveRequiresReview(null, [], true)).toBe(true);
    expect(deriveRequiresReview("allan", ["allan"], true)).toBe(true);
  });

  it("o nome North AI em texto livre não concede o papel de revisora", () => {
    expect(deriveRequiresReview(null, [], false)).toBe(false);
  });
});
