import { describe, expect, it } from "vitest";
import {
  TASK_STATUSES,
  anyClientHasFlowEnabled,
  canLeaveRevisao,
  clientApprovalActionSchema,
  flowFlagsCascadeEffects,
  requiresManagerApproval,
  type ClientFlowFlags,
} from "./validation";

const flags = (overrides: Partial<ClientFlowFlags> = {}): ClientFlowFlags => ({
  revisaoAdmin: false,
  revisaoCliente: false,
  aprovacaoAdmin: false,
  aprovacaoCliente: false,
  ...overrides,
});

describe("TASK_STATUSES", () => {
  it("keeps the Kanban column order, with the new Concluído stage between Aprovação and Publicado", () => {
    expect(TASK_STATUSES).toEqual(["backlog", "em_producao", "revisao", "aprovacao", "aprovado", "concluido"]);
  });
});

describe("requiresManagerApproval", () => {
  it("gates moving a card INTO aprovado (approving)", () => {
    expect(requiresManagerApproval("aprovacao", "aprovado")).toBe(true);
  });

  it("gates moving a card OUT of aprovado back to aprovacao (reopening)", () => {
    expect(requiresManagerApproval("aprovado", "aprovacao")).toBe(true);
  });

  it("does NOT gate an ordinary move out of aprovacao to anything other than aprovado", () => {
    // Regression test for the reported prod bug: dragging a card that is
    // sitting in Aprovação to any column other than Concluído (aprovado)
    // must never hit the manager-only 403.
    expect(requiresManagerApproval("aprovacao", "em_producao")).toBe(false);
    expect(requiresManagerApproval("aprovacao", "revisao")).toBe(false);
    expect(requiresManagerApproval("aprovacao", "backlog")).toBe(false);
    expect(requiresManagerApproval("aprovacao", "concluido")).toBe(false);
  });

  it("does not gate moves that never touch aprovado at all", () => {
    expect(requiresManagerApproval("backlog", "em_producao")).toBe(false);
    expect(requiresManagerApproval("revisao", "aprovacao")).toBe(false);
  });

  it("treats a missing next status (position-only patch) as not an approval decision", () => {
    expect(requiresManagerApproval("aprovacao", undefined)).toBe(false);
  });
});

describe("canLeaveRevisao", () => {
  it("blocks anyone other than the assigned reviewer from moving a card out of Revisão", () => {
    expect(canLeaveRevisao("revisao", "user-a", "user-b")).toBe(false);
    expect(canLeaveRevisao("revisao", "user-a", "user-a")).toBe(true);
  });

  it("regression: an unclaimed card (no reviewer yet) must not lock EVERY admin out, gerente included", () => {
    // Live-reproduced prod bug: reviewer_id null failed `!== actingUserId`
    // for every single admin, so an unassigned Revisão card could never be
    // moved by anyone, including managers.
    expect(canLeaveRevisao("revisao", null, "any-admin-id")).toBe(true);
    expect(canLeaveRevisao("revisao", undefined, "any-admin-id")).toBe(true);
  });

  it("is a no-op for any status other than Revisão", () => {
    expect(canLeaveRevisao("aprovacao", "user-a", "user-b")).toBe(true);
    expect(canLeaveRevisao("em_producao", null, "any-admin-id")).toBe(true);
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

describe("anyClientHasFlowEnabled", () => {
  it("is false for both flows when no client has anything on", () => {
    expect(anyClientHasFlowEnabled([flags(), flags()])).toEqual({ anyRevisaoAdmin: false, anyAprovacaoAdmin: false });
  });

  it("is true as soon as ONE client (out of many) has the toggle on", () => {
    const many = [flags(), flags({ revisaoAdmin: true }), flags()];
    expect(anyClientHasFlowEnabled(many)).toEqual({ anyRevisaoAdmin: true, anyAprovacaoAdmin: false });
  });

  it("tracks Revisão and Aprovação independently", () => {
    const mixed = [flags({ aprovacaoAdmin: true }), flags({ revisaoAdmin: true })];
    expect(anyClientHasFlowEnabled(mixed)).toEqual({ anyRevisaoAdmin: true, anyAprovacaoAdmin: true });
  });

  it("is false for an empty client list", () => {
    expect(anyClientHasFlowEnabled([])).toEqual({ anyRevisaoAdmin: false, anyAprovacaoAdmin: false });
  });
});

describe("flowFlagsCascadeEffects (critical: toggling a stage off must flush its cards)", () => {
  it("turning Revisão admin OFF produces the clear+move effect", () => {
    const current = flags({ revisaoAdmin: true });
    const next = flags({ revisaoAdmin: false });
    expect(flowFlagsCascadeEffects(current, next)).toEqual(["clear_reviewer_and_move_revisao_to_em_producao"]);
  });

  it("turning Aprovação admin OFF produces the clear+move effect", () => {
    const current = flags({ aprovacaoAdmin: true });
    const next = flags({ aprovacaoAdmin: false });
    expect(flowFlagsCascadeEffects(current, next)).toEqual(["clear_approver_and_move_aprovacao_to_em_producao"]);
  });

  it("turning BOTH off at once produces both effects", () => {
    const current = flags({ revisaoAdmin: true, aprovacaoAdmin: true });
    const next = flags({ revisaoAdmin: false, aprovacaoAdmin: false });
    expect(flowFlagsCascadeEffects(current, next)).toEqual([
      "clear_reviewer_and_move_revisao_to_em_producao",
      "clear_approver_and_move_aprovacao_to_em_producao",
    ]);
  });

  it("turning a stage ON produces NO effect — no history to restore, cards stay put", () => {
    expect(flowFlagsCascadeEffects(flags({ revisaoAdmin: false }), flags({ revisaoAdmin: true }))).toEqual([]);
    expect(flowFlagsCascadeEffects(flags({ aprovacaoAdmin: false }), flags({ aprovacaoAdmin: true }))).toEqual([]);
  });

  it("no-op when nothing changes", () => {
    const same = flags({ revisaoAdmin: true, aprovacaoAdmin: true });
    expect(flowFlagsCascadeEffects(same, same)).toEqual([]);
  });

  it("does not fire from an already-off state (only on the true->false transition)", () => {
    expect(flowFlagsCascadeEffects(flags({ revisaoAdmin: false }), flags({ revisaoAdmin: false }))).toEqual([]);
  });
});
