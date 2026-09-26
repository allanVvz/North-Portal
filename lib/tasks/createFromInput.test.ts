import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskCreateSchema } from "@/lib/validation";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/taskTypes", async (original) => ({
  ...(await original<typeof import("@/lib/taskTypes")>()),
  listTaskTypes: vi.fn(async () => [
    { key: "operacional", behavior: "simples" },
    { key: "criativo", behavior: "entrega" },
    { key: "automacao", behavior: "entrega" },
    { key: "entrega_reels", behavior: "entrega" },
  ]),
}));
vi.mock("@/lib/supabase", () => ({
  createTask: vi.fn(async (_client: unknown, fields: Record<string, unknown>) => ({ id: "simple", ...fields, parents: [] })),
  createFlowDelivery: vi.fn(async (_client: unknown, fields: Record<string, unknown>) => ({
    delivery: { id: "delivery", ...fields, workflow_version_id: "published-v1" },
    step: { id: "roteiro", kind: "operacional", subtype: "roteiro", parents: [{ id: "delivery", relation_kind: "workflow_step" }] },
  })),
  getTaskById: vi.fn(async () => null),
}));
vi.mock("@/lib/notifications", () => ({ notifyTaskParticipants: vi.fn(async () => {}), taskCreatedMessage: vi.fn(() => "criado") }));

import { createTask, createFlowDelivery } from "@/lib/supabase";
import { createTaskFromInput } from "./createFromInput";

describe("criação por classificação persistida", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Tarefa · Reels segue a criação simples com operacional/reels", async () => {
    const result = await createTaskFromInput(taskCreateSchema.parse({ title: "Roteiro avulso", kind: "operacional", subtype: "reels" }), "task");
    expect(result.delivery).toBeNull();
    expect(result.task).toMatchObject({ kind: "operacional", subtype: "reels" });
    expect(createTask).toHaveBeenCalledWith(null, expect.objectContaining({ kind: "operacional", subtype: "reels" }));
    expect(createFlowDelivery).not.toHaveBeenCalled();
  });

  it.each(["entrega_reels", "criativo", "automacao"])("%s usa a versão publicada do fluxo", async (kind) => {
    const result = await createTaskFromInput(taskCreateSchema.parse({ title: "Peça", kind }), "task");
    expect(result.delivery).toMatchObject({ workflow_version_id: "published-v1" });
    expect(result.task).toMatchObject({ subtype: "roteiro" });
    expect(createFlowDelivery).toHaveBeenCalledWith(null, expect.objectContaining({ kind }), kind);
    expect(vi.mocked(createFlowDelivery).mock.calls[0][1].subtype).toBeUndefined();
    expect(createTask).not.toHaveBeenCalled();
    if (kind === "entrega_reels") expect(vi.mocked(createFlowDelivery).mock.calls[0][1]).toMatchObject({ payload: { formato: "Reels" } });
  });
});
