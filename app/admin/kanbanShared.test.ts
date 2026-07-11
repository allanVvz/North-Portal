import { describe, expect, it } from "vitest";
import { COLUMNS, STATUS_LABEL, visibleColumnsFor } from "./kanbanShared";

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

describe("visibleColumnsFor (Revisão/Aprovação column visibility)", () => {
  it("hides Revisão and Aprovação when the toggle is off for every client and no card sits in either status", () => {
    const tasks = [{ status: "backlog" as const }, { status: "em_producao" as const }];
    expect(visibleColumnsFor(tasks, false, false).map((c) => c.status)).toEqual([
      "backlog", "em_producao", "aprovado", "concluido",
    ]);
  });

  it("shows the column as soon as the toggle is on for ANY client, even with zero cards", () => {
    // Regression test: turning "Ativo para Admin" on for Aprovação must make
    // the column show up immediately, not wait for a card to land in it —
    // an admin needs to be able to drag a card into an empty column.
    const noCardsYet: { status: "backlog" | "aprovacao" }[] = [{ status: "backlog" }];
    expect(visibleColumnsFor(noCardsYet, false, true).some((c) => c.status === "aprovacao")).toBe(true);
    expect(visibleColumnsFor(noCardsYet, false, false).some((c) => c.status === "aprovacao")).toBe(false);
  });

  it("shows Aprovação when a card sits in it even if the toggle is currently off (safety net)", () => {
    // Should be unreachable in practice (toggling off cascades cards out
    // immediately) but a column must never hide a card that's still in it.
    const tasks = [{ status: "backlog" as const }, { status: "aprovacao" as const }];
    expect(visibleColumnsFor(tasks, false, false).map((c) => c.status)).toEqual([
      "backlog", "em_producao", "aprovacao", "aprovado", "concluido",
    ]);
  });

  it("shows both Revisão and Aprovação once both toggles are on", () => {
    expect(visibleColumnsFor([], true, true)).toHaveLength(6);
  });

  it("hides Aprovação again once the toggle is off and its last card has moved elsewhere", () => {
    expect(visibleColumnsFor([{ status: "aprovacao" as const }], false, true).some((c) => c.status === "aprovacao")).toBe(true);
    expect(visibleColumnsFor([{ status: "em_producao" as const }], false, false).some((c) => c.status === "aprovacao")).toBe(false);
  });
});
