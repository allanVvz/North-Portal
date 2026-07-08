import { describe, expect, it } from "vitest";
import { TASK_STATUSES, clientApprovalActionSchema } from "./validation";

describe("TASK_STATUSES", () => {
  it("keeps the Kanban column order, with the new Concluído stage between Aprovação and Publicado", () => {
    expect(TASK_STATUSES).toEqual(["backlog", "em_producao", "revisao", "aprovacao", "aprovado", "concluido"]);
  });
});

describe("clientApprovalActionSchema", () => {
  it("accepts 'aprovar' without a comment", () => {
    expect(clientApprovalActionSchema.safeParse({ action: "aprovar" }).success).toBe(true);
  });

  it("requires a non-empty comment for 'ajustes'", () => {
    expect(clientApprovalActionSchema.safeParse({ action: "ajustes" }).success).toBe(false);
    expect(clientApprovalActionSchema.safeParse({ action: "ajustes", comment: "   " }).success).toBe(false);
    expect(clientApprovalActionSchema.safeParse({ action: "ajustes", comment: "Trocar a cor." }).success).toBe(true);
  });
});
