import { describe, expect, it } from "vitest";
import {
  activatedTaskPayload,
  belongsToTaskScreen,
  childrenByParent,
  childrenOf,
  detachedRecurrencePatch,
  flowStepKeyOf,
  hasParent,
  isDeferredTask,
  actionPlanMembersOf,
  deliveryParentIdsOf,
  familyRootIdOf,
  flowStepsOf,
  isFlowDelivery,
  parentIdsOf,
  planParentIdOf,
  recurrenceParentOf,
  slotOf,
  visibleOnTaskBoard,
} from "./taskRelations";

describe("relações entre tarefas", () => {
  it("resolve a relação imutável da execução com o card pai carregado", () => {
    const tasks = [{ id: "parent" }, { id: "other" }];
    expect(recurrenceParentOf("parent", tasks)).toEqual({ id: "parent" });
    expect(recurrenceParentOf("missing", tasks)).toBeNull();
    expect(recurrenceParentOf(null, tasks)).toBeNull();
  });

  it("mantém a execução futura escondida do quadro", () => {
    const child = { parents: [], payload: { deferred_until_accessed: true } };
    expect(isDeferredTask(child)).toBe(true);
    expect(visibleOnTaskBoard(child)).toBe(false);
  });

  it("materializa a tarefa no primeiro acesso sem perder seu payload", () => {
    const payload = activatedTaskPayload({ deferred_until_accessed: true, recurrence_parent_id: "parent" }, "2026-07-21T12:00:00.000Z");
    expect(payload).toEqual({ recurrence_parent_id: "parent", accessed_at: "2026-07-21T12:00:00.000Z" });
  });

  // Desvincular uma ocorrência limpa a metadata de recorrência junto com o FK:
  // deixá-la para trás faria o card continuar parecendo relacionado.
  it("torna uma execução recorrente independente sem perder seu conteúdo", () => {
    const occurrence = {
      plan_id: "recurrence-parent",
      payload: { recurrence_parent_id: "recurrence-parent", recurrence_cycle: 2, comments: [{ text: "oi" }] },
    };
    expect(detachedRecurrencePatch(occurrence, "recurrence-parent")).toEqual({
      plan_id: null,
      payload: { comments: [{ text: "oi" }] },
    });
    expect(detachedRecurrencePatch(occurrence, "outro-pai")).toBeNull();
  });
});

describe("pertencimento N:N (task_links)", () => {
  // O ponto todo da mudança: o mesmo roteiro serve várias peças, a mesma
  // diária de gravação serve vários criativos.
  const roteiro = { parents: [{ id: "entrega-a", slot: "roteiro" }, { id: "entrega-b", slot: "roteiro" }] };
  const avulsa = { parents: [] };

  it("um card pertence a vários pais ao mesmo tempo", () => {
    expect(parentIdsOf(roteiro)).toEqual(["entrega-a", "entrega-b"]);
    expect(hasParent(roteiro, "entrega-b")).toBe(true);
    expect(hasParent(avulsa, "entrega-a")).toBe(false);
  });

  it("conta o card em cada pai de que participa", () => {
    const map = childrenByParent([roteiro, avulsa]);
    expect(map.get("entrega-a")).toEqual([roteiro]);
    expect(map.get("entrega-b")).toEqual([roteiro]);
    expect(childrenOf("entrega-a", [roteiro, avulsa])).toEqual([roteiro]);
  });

  it("o slot é por pai — o mesmo card pode ocupar etapas diferentes", () => {
    const compartilhado = { parents: [{ id: "p1", slot: "roteiro" }, { id: "p2", slot: null }] };
    expect(slotOf(compartilhado, "p1")).toBe("roteiro");
    expect(slotOf(compartilhado, "p2")).toBeNull();
    expect(slotOf(compartilhado, "inexistente")).toBeNull();
  });
});

// `flowStepsOf` e `actionPlanMembersOf` ERAM a mesma função, sem filtro nenhum.
// Isso só não doía enquanto os dois mundos não se encontravam. Estes testes são
// o que impede o alias de voltar.
describe("etapa de entrega × membro de plano", () => {
  const entregaId = "entrega-1";
  const planoId = "plano-1";
  // O card difícil: etapa de uma entrega E membro de um plano ao mesmo tempo.
  const etapaNoPlano = { id: "s1", parents: [{ id: entregaId, slot: "roteiro" }, { id: planoId, slot: null }] };
  const soEtapa = { id: "s2", parents: [{ id: entregaId, slot: "captacao" }] };
  const soMembro = { id: "m1", parents: [{ id: planoId, slot: null }] };
  const todos = [etapaNoPlano, soEtapa, soMembro];

  it("etapa é filho COM slot; membro de plano é filho SEM slot", () => {
    expect(flowStepsOf(entregaId, todos).map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(actionPlanMembersOf(planoId, todos).map((t) => t.id)).toEqual(["s1", "m1"]);
    // E o cruzado tem que dar vazio — era exatamente isto que o alias não fazia.
    expect(flowStepsOf(planoId, todos)).toEqual([]);
    expect(actionPlanMembersOf(entregaId, todos)).toEqual([]);
  });

  it("o plano de um card é o elo SEM slot, em qualquer ordem do array", () => {
    // A consulta de pais não tem ORDER BY. Ler `parents[0]` fazia o autosave
    // mandar o id da ENTREGA como se fosse o plano — e apagar a associação
    // real. Por isso as duas ordens são afirmadas.
    expect(planParentIdOf(etapaNoPlano)).toBe(planoId);
    expect(planParentIdOf({ parents: [{ id: planoId, slot: null }, { id: entregaId, slot: "roteiro" }] })).toBe(planoId);
    expect(planParentIdOf(soEtapa)).toBeNull();
  });

  it("as entregas de que um card é etapa saem separadas do plano", () => {
    expect(deliveryParentIdsOf(etapaNoPlano)).toEqual([entregaId]);
    expect(deliveryParentIdsOf(soMembro)).toEqual([]);
  });

  it("familyRootIdOf: entrega tem precedência sobre plano; card avulso é null", () => {
    expect(familyRootIdOf(etapaNoPlano)).toBe(entregaId); // é etapa E membro → a entrega
    expect(familyRootIdOf(soEtapa)).toBe(entregaId);
    expect(familyRootIdOf(soMembro)).toBe(planoId);
    expect(familyRootIdOf({ parents: [] })).toBeNull();
  });
});

describe("entregas de fluxo", () => {
  // A etapa que um card É vem do próprio subtipo: os subtipos de um
  // tipo-entrega SÃO as etapas dele, sem segunda lista para sincronizar.
  it("lê a etapa a partir do subtipo do card", () => {
    expect(flowStepKeyOf({ subtype: "captacao" })).toBe("captacao");
    expect(flowStepKeyOf({ subtype: null })).toBeNull();
  });

  // Marca explícita, e não inferida do tipo: há cards `criativo` legados que
  // são trabalho comum e não podem virar pais de uma hora para outra.
  it("reconhece a entrega pela marca no payload, não pelo tipo", () => {
    expect(isFlowDelivery({ payload: { flow_parent: true } })).toBe(true);
    expect(isFlowDelivery({ payload: {} })).toBe(false);
  });

  it("mantém a entrega fora do quadro Tarefas e a etapa dentro", () => {
    const entrega = { kind: "criativo", recurrence_cadence: null, payload: { flow_parent: true } } as const;
    const etapa = { kind: "criativo", recurrence_cadence: null, payload: {} } as const;
    const legado = { kind: "criativo", recurrence_cadence: null, payload: {} } as const;
    expect(belongsToTaskScreen(entrega)).toBe(false);
    expect(belongsToTaskScreen(etapa)).toBe(true);
    // O card criativo antigo continua sendo trabalho comum no quadro.
    expect(belongsToTaskScreen(legado)).toBe(true);
  });

  it("mantém plano e pai recorrente fora do quadro, como antes", () => {
    expect(belongsToTaskScreen({ kind: "plano_acao", recurrence_cadence: null, payload: {} })).toBe(false);
    expect(belongsToTaskScreen({ kind: "operacional", recurrence_cadence: "semanal", payload: {} })).toBe(false);
    expect(belongsToTaskScreen({ kind: "operacional", recurrence_cadence: null, payload: {} })).toBe(true);
  });
});
