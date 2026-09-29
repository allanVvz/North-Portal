import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminTask: vi.fn(), transitionTaskStatus: vi.fn(), approveTask: vi.fn(),
  returnEditFinalsToPreview: vi.fn(),
}));
vi.mock("@/lib/automations/taskAccess", () => ({ getAdminTask: mocks.getAdminTask }));
vi.mock("@/lib/automations/taskWrites", () => ({ transitionTaskStatus: mocks.transitionTaskStatus }));
vi.mock("./approve", () => ({ approveTask: mocks.approveTask }));
vi.mock("@/lib/creativeDriveSync", () => ({ returnEditFinalsToPreview: mocks.returnEditFinalsToPreview }));

import { handleReviewDecision } from "./creativeReview";

const edit = {
  id: "edit-a", title: "Peça A — Edição", subtype: "edicao", status: "revisao",
  reviewer_id: "cintia", payload: { reviewer_ids: ["cintia", "luiza"] },
};
const db = {
  from(table: string) {
    if (table === "task_assignees") return {
      select: () => ({ eq: async () => ({ data: [{ profile_id: "editor" }], error: null }) }),
    };
    if (table === "task_links") return {
      select: () => ({ eq: () => ({ eq: async () => ({ data: [{ parent_id: "piece-a" }], error: null }) }) }),
    };
    if (table === "notifications") return { insert: async (rows: unknown) => { notifications.push(rows); return { error: null }; } };
    throw new Error(table);
  },
};
const notifications: unknown[] = [];

describe("decisão de revisão por botão", () => {
  beforeEach(() => {
    vi.clearAllMocks(); notifications.length = 0;
    mocks.getAdminTask.mockResolvedValue(edit);
    mocks.transitionTaskStatus.mockResolvedValue({ ...edit, status: "em_producao" });
  });

  it("Luiza pode aprovar a peça e disparar a cascata", async () => {
    expect(await handleReviewDecision(db as never, edit.id, "luiza", "aprovar")).toBe(true);
    expect(mocks.approveTask).toHaveBeenCalledWith(db, edit, { actorId: "luiza", from: ["revisao"] });
    expect(mocks.transitionTaskStatus).not.toHaveBeenCalled();
  });

  it("Cintia devolve só esta Edição e avisa seu responsável", async () => {
    expect(await handleReviewDecision(db as never, edit.id, "cintia", "ajustes")).toBe(true);
    expect(mocks.transitionTaskStatus).toHaveBeenCalledWith(db, edit.id, { from: ["revisao"], to: "em_producao" });
    expect(notifications).toEqual([[expect.objectContaining({ profile_id: "editor", task_id: edit.id })]]);
    expect(mocks.returnEditFinalsToPreview).toHaveBeenCalledWith(db, edit.id, ["piece-a"]);
    expect(mocks.approveTask).not.toHaveBeenCalled();
  });

  it("outro perfil não decide a revisão", async () => {
    expect(await handleReviewDecision(db as never, edit.id, "outro", "aprovar")).toBe(false);
    expect(mocks.approveTask).not.toHaveBeenCalled();
  });

  it("sem decisão (comentário livre) não muda nada — nem lê o card", async () => {
    expect(await handleReviewDecision(db as never, edit.id, "luiza", null)).toBe(false);
    expect(await handleReviewDecision(db as never, edit.id, "luiza", "revisao")).toBe(false);
    expect(mocks.getAdminTask).not.toHaveBeenCalled();
    expect(mocks.approveTask).not.toHaveBeenCalled();
    expect(mocks.transitionTaskStatus).not.toHaveBeenCalled();
  });

  it("vale para qualquer card em Revisão; só a Edição devolve finais ao Preview", async () => {
    const roteiro = { ...edit, id: "roteiro-a", subtype: "roteiro" };
    mocks.getAdminTask.mockResolvedValue(roteiro);
    mocks.transitionTaskStatus.mockResolvedValue({ ...roteiro, status: "em_producao" });
    expect(await handleReviewDecision(db as never, roteiro.id, "cintia", "ajustes")).toBe(true);
    expect(mocks.transitionTaskStatus).toHaveBeenCalledWith(db, roteiro.id, { from: ["revisao"], to: "em_producao" });
    expect(mocks.returnEditFinalsToPreview).not.toHaveBeenCalled();
  });

  it("card fora de Revisão não é decidido", async () => {
    mocks.getAdminTask.mockResolvedValue({ ...edit, status: "em_producao" });
    expect(await handleReviewDecision(db as never, edit.id, "luiza", "aprovar")).toBe(false);
    expect(mocks.approveTask).not.toHaveBeenCalled();
  });
});
