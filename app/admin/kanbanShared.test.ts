import { describe, expect, it } from "vitest";
import { COLUMNS, STATUS_LABEL, WORKFLOW_ORDER, visibleColumnsFor } from "./kanbanShared";

describe("Kanban COLUMNS", () => {
  it("tem 6 colunas, Parada primeiro e Concluído no fim", () => {
    // "Parada" primeiro: é estado de erro de automação, não a etapa seguinte a
    // Concluído. Ver o comentário em kanbanShared.ts.
    // Seis, não sete: "Publicado" saiu. Este teste é o que trava o vocabulário
    // — quem quiser reintroduzir um estágio tem que passar por aqui.
    expect(COLUMNS.map((c) => c.status)).toEqual([
      "parada",
      "backlog",
      "em_producao",
      "revisao",
      "aprovacao",
      "aprovado",
    ]);
    expect(COLUMNS.map((c) => c.label)).toEqual([
      "Parada",
      "Entrada",
      "Em produção",
      "Revisão",
      "Aprovação",
      "Concluído",
    ]);
    expect(COLUMNS.some((c) => c.label === "Publicado")).toBe(false);
  });

  it("WORKFLOW_ORDER exclui parada — card parado não tem etapa cumprida", () => {
    // Com parada no índice 0 de STATUS_ORDER, comparar por índice a marcaria
    // como cumprida em toda tarefa. WORKFLOW_ORDER é a lista que o stepper usa.
    expect(WORKFLOW_ORDER).not.toContain("parada");
    expect(WORKFLOW_ORDER.indexOf("parada")).toBe(-1);
    expect(WORKFLOW_ORDER[0]).toBe("backlog");
    expect(WORKFLOW_ORDER).toHaveLength(COLUMNS.length - 1);
  });

  it("STATUS_LABEL is derived from COLUMNS and covers every status", () => {
    expect(STATUS_LABEL.aprovado).toBe("Concluído");
    expect(STATUS_LABEL.parada).toBe("Parada");
    expect(Object.keys(STATUS_LABEL)).toHaveLength(6);
  });
});

describe("visibleColumnsFor (Revisão/Aprovação column visibility)", () => {
  it("hides Revisão and Aprovação when the toggle is off for every client and no card sits in either status", () => {
    const tasks = [{ status: "backlog" as const }, { status: "em_producao" as const }];
    expect(visibleColumnsFor(tasks, false, false).map((c) => c.status)).toEqual([
      "backlog", "em_producao", "aprovado",
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
      "backlog", "em_producao", "aprovacao", "aprovado",
    ]);
  });

  it("shows both Revisão and Aprovação once both toggles are on", () => {
    expect(visibleColumnsFor([], true, true)).toHaveLength(5);
  });

  it("hides Aprovação again once the toggle is off and its last card has moved elsewhere", () => {
    expect(visibleColumnsFor([{ status: "aprovacao" as const }], false, true).some((c) => c.status === "aprovacao")).toBe(true);
    expect(visibleColumnsFor([{ status: "em_producao" as const }], false, false).some((c) => c.status === "aprovacao")).toBe(false);
  });
});

describe("visibleColumnsFor (Parada column visibility)", () => {
  it("hides Parada when no card sits in it — no toggle, purely card-driven", () => {
    expect(visibleColumnsFor([{ status: "backlog" as const }], true, true).some((c) => c.status === "parada")).toBe(false);
  });

  it("shows Parada as soon as a card is halted in it", () => {
    const tasks = [{ status: "backlog" as const }, { status: "parada" as const }];
    expect(visibleColumnsFor(tasks, false, false).some((c) => c.status === "parada")).toBe(true);
  });
});

// Os describes "visibleColumnsFor (Publicado column visibility)" e "Publicado
// merged into Concluído" moravam aqui. Sumiram com o estágio: publicar deixou
// de ser nível de tarefa nenhuma, então não há coluna a esconder nem projeção
// visual a fazer dentro de Concluído.
