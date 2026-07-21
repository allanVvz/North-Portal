import { describe, expect, it } from "vitest";
import { activatedTaskPayload, childrenOf, isDeferredTask, visibleOnTaskBoard } from "./taskRelations";

describe("relações entre tarefas", () => {
  it("mantém a execução futura sob o pai sem exibi-la no quadro", () => {
    const child = { id: "child", plan_id: "parent", payload: { deferred_until_accessed: true } };
    expect(childrenOf("parent", [child])).toEqual([child]);
    expect(isDeferredTask(child)).toBe(true);
    expect(visibleOnTaskBoard(child)).toBe(false);
  });

  it("materializa a tarefa no primeiro acesso sem perder seu payload", () => {
    const payload = activatedTaskPayload({ deferred_until_accessed: true, recurrence_parent_id: "parent" }, "2026-07-21T12:00:00.000Z");
    expect(payload).toEqual({ recurrence_parent_id: "parent", accessed_at: "2026-07-21T12:00:00.000Z" });
  });
});
