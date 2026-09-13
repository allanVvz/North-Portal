import { describe, expect, it } from "vitest";
import { stepRoleOf } from "./stepRole";

describe("stepRoleOf — papel de uma pessoa numa etapa", () => {
  it("é a revisora da etapa: 'revisor', mesmo que também esteja entre os responsáveis", () => {
    const step = { reviewer_id: "allan", subtype: "edicao" };
    expect(stepRoleOf(step, new Set(["allan"]), "allan")).toEqual({ kind: "revisor" });
  });

  it("é responsável (não revisora): 'responsavel', com a responsabilidade do subtipo", () => {
    const step = { reviewer_id: "cintia", subtype: "edicao" };
    expect(stepRoleOf(step, new Set(["allan"]), "allan")).toEqual({
      kind: "responsavel",
      responsibility: "edicao",
    });
  });

  it("responsável de um subtipo sem responsabilidade cadastrada (ex.: publicacao): responsibility null", () => {
    const step = { reviewer_id: null, subtype: "publicacao" };
    expect(stepRoleOf(step, new Set(["allan"]), "allan")).toEqual({
      kind: "responsavel",
      responsibility: null,
    });
  });

  it("não é revisora nem está entre os responsáveis: null", () => {
    const step = { reviewer_id: "cintia", subtype: "edicao" };
    expect(stepRoleOf(step, new Set(["luiza"]), "allan")).toBeNull();
  });

  it("sem profileId (comentário sem autor identificado): null", () => {
    const step = { reviewer_id: "allan", subtype: "edicao" };
    expect(stepRoleOf(step, new Set(["allan"]), null)).toBeNull();
  });
});
