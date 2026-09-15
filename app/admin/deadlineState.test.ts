import { describe, expect, it } from "vitest";
import { deadlineStateOf, needsAttention } from "./deadlineState";

const today = "2026-09-15";

describe("deadlineStateOf", () => {
  it("prazo vencido e não concluído é atrasada", () => {
    expect(deadlineStateOf({ status: "em_producao", due_date: "2026-09-14" }, today)).toBe("atrasada");
  });

  it("vence hoje ainda está no prazo", () => {
    expect(deadlineStateOf({ status: "backlog", due_date: today }, today)).toBe("no_prazo");
  });

  it("sem data é no prazo", () => {
    expect(deadlineStateOf({ status: "revisao", due_date: null }, today)).toBe("no_prazo");
  });

  it("concluída nunca fica atrasada", () => {
    expect(deadlineStateOf({ status: "aprovado", due_date: "2026-01-01" }, today)).toBe("concluida");
  });

  it("parada vence atrasada", () => {
    expect(deadlineStateOf({ status: "parada", due_date: "2026-09-01" }, today)).toBe("parada");
  });

  it("atrasada e parada pedem ação; no prazo e concluída não", () => {
    expect(needsAttention("atrasada")).toBe(true);
    expect(needsAttention("parada")).toBe(true);
    expect(needsAttention("no_prazo")).toBe(false);
    expect(needsAttention("concluida")).toBe(false);
  });
});
