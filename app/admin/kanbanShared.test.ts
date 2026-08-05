import { describe, expect, it } from "vitest";
import { COLUMNS, STATUS_LABEL, statusAfterKanbanDrop, tasksForKanbanColumn, visibleColumnsFor } from "./kanbanShared";

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
    expect(visibleColumnsFor(tasks, false, false, true).map((c) => c.status)).toEqual([
      "backlog", "em_producao", "aprovado", "concluido",
    ]);
  });

  it("shows the column as soon as the toggle is on for ANY client, even with zero cards", () => {
    // Regression test: turning "Ativo para Admin" on for Aprovação must make
    // the column show up immediately, not wait for a card to land in it —
    // an admin needs to be able to drag a card into an empty column.
    const noCardsYet: { status: "backlog" | "aprovacao" }[] = [{ status: "backlog" }];
    expect(visibleColumnsFor(noCardsYet, false, true, true).some((c) => c.status === "aprovacao")).toBe(true);
    expect(visibleColumnsFor(noCardsYet, false, false, true).some((c) => c.status === "aprovacao")).toBe(false);
  });

  it("shows Aprovação when a card sits in it even if the toggle is currently off (safety net)", () => {
    // Should be unreachable in practice (toggling off cascades cards out
    // immediately) but a column must never hide a card that's still in it.
    const tasks = [{ status: "backlog" as const }, { status: "aprovacao" as const }];
    expect(visibleColumnsFor(tasks, false, false, true).map((c) => c.status)).toEqual([
      "backlog", "em_producao", "aprovacao", "aprovado", "concluido",
    ]);
  });

  it("shows both Revisão and Aprovação once both toggles are on", () => {
    expect(visibleColumnsFor([], true, true, true)).toHaveLength(6);
  });

  it("hides Aprovação again once the toggle is off and its last card has moved elsewhere", () => {
    expect(visibleColumnsFor([{ status: "aprovacao" as const }], false, true, true).some((c) => c.status === "aprovacao")).toBe(true);
    expect(visibleColumnsFor([{ status: "em_producao" as const }], false, false, true).some((c) => c.status === "aprovacao")).toBe(false);
  });
});

describe("visibleColumnsFor (Publicado column visibility)", () => {
  it("hides Publicado when the global switch is off, no card exceptions", () => {
    expect(visibleColumnsFor([], true, true, false).some((c) => c.status === "concluido")).toBe(false);
  });

  it("hides Publicado even when a card already sits in that status — no safety net (unlike Revisão/Aprovação)", () => {
    const tasks = [{ status: "concluido" as const }];
    expect(visibleColumnsFor(tasks, true, true, false).some((c) => c.status === "concluido")).toBe(false);
  });

  it("shows Publicado once the global switch is on", () => {
    expect(visibleColumnsFor([], false, false, true).some((c) => c.status === "concluido")).toBe(true);
  });
});

describe("Publicado merged into Concluído", () => {
  const tasks = [
    { id: "approved", status: "aprovado" as const },
    { id: "published", status: "concluido" as const },
    { id: "production", status: "em_producao" as const },
  ];

  it("groups approved and published cards only while the Publicado column is hidden", () => {
    expect(tasksForKanbanColumn(tasks, "aprovado", false).map((task) => task.id)).toEqual(["approved", "published"]);
    expect(tasksForKanbanColumn(tasks, "aprovado", true).map((task) => task.id)).toEqual(["approved"]);
    expect(tasksForKanbanColumn(tasks, "concluido", true).map((task) => task.id)).toEqual(["published"]);
  });

  it("preserves a published status when reordered in the merged column", () => {
    expect(statusAfterKanbanDrop("concluido", "aprovado", false)).toBe("concluido");
    expect(statusAfterKanbanDrop("em_producao", "aprovado", false)).toBe("aprovado");
    expect(statusAfterKanbanDrop("concluido", "aprovado", true)).toBe("aprovado");
  });
});
