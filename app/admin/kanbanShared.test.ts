import { describe, expect, it } from "vitest";
import { COLUMNS, STATUS_LABEL } from "./kanbanShared";

describe("Kanban COLUMNS", () => {
  it("has 6 columns, Concluído sitting between Aprovação and Publicado", () => {
    expect(COLUMNS.map((c) => c.status)).toEqual([
      "backlog",
      "em_producao",
      "revisao",
      "aprovacao",
      "aprovado",
      "concluido",
    ]);
    expect(COLUMNS.map((c) => c.label)).toEqual([
      "Entrada",
      "Em produção",
      "Revisão",
      "Aprovação",
      "Concluído",
      "Publicado",
    ]);
  });

  it("STATUS_LABEL is derived from COLUMNS and covers every status", () => {
    expect(STATUS_LABEL.aprovado).toBe("Concluído");
    expect(STATUS_LABEL.concluido).toBe("Publicado");
    expect(Object.keys(STATUS_LABEL)).toHaveLength(6);
  });
});
