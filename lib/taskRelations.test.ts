import { describe, expect, it } from "vitest";
import { actionPlanIdOf, actionPlanMembersOf, activatedTaskPayload, belongsToTaskScreen, childrenOf, detachedTaskRelationPatch, flowParentIdOf, flowStepKeyOf, flowStepsOf, isDeferredTask, recurrenceParentOf, recurringActionPlanPatch, visibleOnTaskBoard } from "./taskRelations";

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

  it("torna uma execução recorrente independente sem perder seu conteúdo", () => {
    const patch = detachedTaskRelationPatch({
      plan_id: "recurrence-parent",
      payload: {
        recurrence_parent_id: "recurrence-parent",
        recurrence_cycle: 2,
        occurrence_date: "2026-08-05",
        deferred_until_accessed: true,
        comments: [{ text: "conteúdo preservado" }],
        action_plan_id: "action-plan",
      },
    }, "recurrence-parent");

    expect(patch).toEqual({
      plan_id: null,
      payload: {
        comments: [{ text: "conteúdo preservado" }],
        action_plan_id: "action-plan",
      },
    });
  });

  it("remove apenas a ligação secundária com o plano", () => {
    const patch = detachedTaskRelationPatch({
      plan_id: "recurrence-parent",
      payload: {
        recurrence_parent_id: "recurrence-parent",
        action_plan_id: "action-plan",
        comments: [],
      },
    }, "action-plan");

    expect(patch).toEqual({
      payload: { recurrence_parent_id: "recurrence-parent", comments: [] },
    });
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

describe("etapas de fluxo em cascata", () => {
  const step = { plan_id: "entrega", payload: { flow_step_key: "captacao" } };

  it("aponta a etapa para a sua entrega", () => {
    expect(flowStepKeyOf(step)).toBe("captacao");
    expect(flowParentIdOf(step)).toBe("entrega");
    expect(flowParentIdOf({ plan_id: "plano", payload: {} })).toBeNull();
  });

  // O plan_id de uma etapa é a ENTREGA, não um plano. Lê-lo como membership
  // faria a etapa aparecer como atividade de um plano que nunca a adotou.
  it("não confunde o vínculo com a entrega com membership de Plano de Ação", () => {
    expect(actionPlanIdOf(step)).toBeNull();
    // O vínculo real com um plano continua cabendo, pela mesma escapatória da recorrência.
    expect(actionPlanIdOf({ ...step, payload: { ...step.payload, action_plan_id: "plano-9" } })).toBe("plano-9");
  });

  it("recusa desvincular uma etapa da sua entrega", () => {
    expect(detachedTaskRelationPatch(step, "entrega")).toBeNull();
    // Um membro comum de plano continua desvinculável.
    expect(detachedTaskRelationPatch({ plan_id: "plano", payload: {} }, "plano")).toEqual({ plan_id: null, payload: {} });
  });

  // A entrega tem status derivado dos filhos — não existe coluna honesta para
  // ela, mesma razão pela qual plano_acao e pai recorrente já ficam de fora.
  it("mantém a entrega fora do quadro Tarefas e a etapa dentro", () => {
    const entrega = { kind: "criativo", recurrence_cadence: null, flow_template_id: "tpl", payload: {} } as const;
    const etapa = { kind: "criativo", recurrence_cadence: null, payload: { flow_step_key: "captacao" } } as const;
    expect(belongsToTaskScreen(entrega)).toBe(false);
    expect(belongsToTaskScreen(etapa)).toBe(true);
  });

  it("agrupa as etapas de uma entrega", () => {
    const outra = { plan_id: "outra-entrega", payload: { flow_step_key: "roteiro" } };
    expect(flowStepsOf("entrega", [step, outra])).toEqual([step]);
  });
});
