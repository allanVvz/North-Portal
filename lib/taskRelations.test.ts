import { describe, expect, it } from "vitest";
import {
  actionPlanIdOf,
  actionPlanMembersOf,
  activatedTaskPayload,
  belongsToTaskScreen,
  childrenOf,
  isDeferredTask,
  recurrenceParentOf,
  recurringActionPlanPatch,
  visibleOnTaskBoard,
} from "./taskRelations";

describe("relações entre tarefas", () => {
  it("resolve a relação imutável da execução com o card pai carregado", () => {
    const tasks = [{ id: "parent" }, { id: "other" }];
    expect(recurrenceParentOf("parent", tasks)).toEqual({ id: "parent" });
    expect(recurrenceParentOf("missing", tasks)).toBeNull();
    expect(recurrenceParentOf(null, tasks)).toBeNull();
  });

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

  it("separa o plano de ação do pai de uma ocorrência recorrente", () => {
    const ordinary = { plan_id: "plan", payload: {} };
    const occurrence = {
      plan_id: "recurrence-parent",
      payload: { recurrence_parent_id: "recurrence-parent", action_plan_id: "plan" },
    };
    expect(actionPlanIdOf(ordinary)).toBe("plan");
    expect(actionPlanIdOf(occurrence)).toBe("plan");
    expect(childrenOf("recurrence-parent", [occurrence])).toEqual([occurrence]);
    expect(actionPlanMembersOf("plan", [ordinary, occurrence])).toEqual([ordinary, occurrence]);
  });

  it("vincula e desvincula uma ocorrência sem sobrescrever seu plan_id", () => {
    const current = {
      plan_id: "recurrence-parent",
      payload: { recurrence_parent_id: "recurrence-parent", comments: [] },
    };
    const linked = recurringActionPlanPatch(current, { plan_id: "action-plan", status: "em_producao" });
    expect(linked).not.toHaveProperty("plan_id");
    expect(linked).toMatchObject({ status: "em_producao", payload: { recurrence_parent_id: "recurrence-parent", action_plan_id: "action-plan" } });

    const unlinked = recurringActionPlanPatch(
      { ...current, payload: linked.payload as Record<string, unknown> },
      { plan_id: null },
    );
    expect(unlinked.payload).toEqual({ recurrence_parent_id: "recurrence-parent", comments: [] });
  });
});

describe("separação da tela Tarefas", () => {
  const base = { kind: "operacional", recurrence_cadence: null, payload: {} } as const;

  it("aceita apenas tarefas comuns", () => {
    expect(belongsToTaskScreen(base)).toBe(true);
    expect(belongsToTaskScreen({ ...base, kind: "plano_acao" })).toBe(false);
    expect(belongsToTaskScreen({ ...base, recurrence_cadence: "semanal" })).toBe(false);
    expect(belongsToTaskScreen({ ...base, payload: { deferred_until_accessed: true } })).toBe(false);
    expect(belongsToTaskScreen({ ...base, payload: { recurrence_group: true } })).toBe(false);
  });
});
