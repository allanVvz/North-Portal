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
  stepOrderOf,
  visibleOnTaskBoard,
  type TaskParentLink,
} from "./taskRelations";

// Elo de pertencimento como o banco devolve. `position` é a ordem da etapa
// DENTRO da corrente (o order_index do subtipo), não a posição do card no
// quadro — só os testes de ordenação se importam com ela; os outros usam o
// default.
const elo = (id: string, slot: string | null = null, position = 0) => ({ id, slot, position });

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
  const roteiro = { parents: [elo("entrega-a", "roteiro"), elo("entrega-b", "roteiro")] };
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
    const compartilhado = { parents: [elo("p1", "roteiro"), elo("p2", null)] };
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
  const etapaNoPlano = { id: "s1", parents: [elo(entregaId, "roteiro"), elo(planoId, null)] };
  const soEtapa = { id: "s2", parents: [elo(entregaId, "captacao")] };
  const soMembro = { id: "m1", parents: [elo(planoId, null)] };
  const todos = [etapaNoPlano, soEtapa, soMembro];

  it("etapa é filho COM slot; membro de plano é filho SEM slot", () => {
    expect(flowStepsOf(entregaId, todos).map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(actionPlanMembersOf(planoId, todos).map((t) => t.id)).toEqual(["s1", "m1"]);
    // E o cruzado tem que dar vazio — era exatamente isto que o alias não fazia.
    expect(flowStepsOf(planoId, todos)).toEqual([]);
    expect(actionPlanMembersOf(entregaId, todos)).toEqual([]);
  });

  // A ordem da corrente vive no ELO, não em `task.position`. Ordenar pela
  // posição do card no quadro é o que fazia a etapa de edição do "Evento Baita
  // 19/09" — anexada à mão, e por isso com a posição que já tinha no Kanban —
  // aparecer como 1/4, na frente do roteiro.
  it("ordena as etapas pela posição do elo, não pela do card no quadro", () => {
    const edicaoAnexada = { id: "edicao", position: -680, parents: [elo(entregaId, "edicao", 30)] };
    const roteiro = { id: "roteiro", position: -640, parents: [elo(entregaId, "roteiro", 10)] };
    const captacao = { id: "captacao", position: -590, parents: [elo(entregaId, "captacao", 20)] };
    const quadro = [edicaoAnexada, roteiro, captacao];
    expect(flowStepsOf(entregaId, quadro).map((t) => t.id)).toEqual(["roteiro", "captacao", "edicao"]);
  });

  // A mesma etapa compartilhada por duas entregas pode ocupar posições
  // diferentes em cada uma — a ordem é por pai, como o slot.
  it("a ordem da etapa é por pai", () => {
    const compartilhada = { parents: [elo("e1", "roteiro", 10), elo("e2", "extra", 40)] };
    expect(stepOrderOf(compartilhada, "e1")).toBe(10);
    expect(stepOrderOf(compartilhada, "e2")).toBe(40);
    expect(stepOrderOf(compartilhada, "inexistente")).toBe(0);
  });

  it("o plano de um card é o elo SEM slot, em qualquer ordem do array", () => {
    // A consulta de pais não tem ORDER BY. Ler `parents[0]` fazia o autosave
    // mandar o id da ENTREGA como se fosse o plano — e apagar a associação
    // real. Por isso as duas ordens são afirmadas.
    expect(planParentIdOf(etapaNoPlano)).toBe(planoId);
    expect(planParentIdOf({ parents: [elo(planoId, null), elo(entregaId, "roteiro")] })).toBe(planoId);
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

// P0-A: `append_task_comment`/`edit_task_comment`/`delete_task_comment`
// devolvem `returning t.*` — só colunas de `tasks`, sem os joins que
// mergeTaskAssigneeRow usa para montar `parents`. Antes da correção em
// lib/supabase.ts, um card assim chegava ao front SEM a propriedade, e
// `TaskModal.tsx` lia `t.parents.some(...)` sem guarda: TypeError, árvore
// React inteira derrubada só por comentar. `parents` não é opcional no tipo
// `TaskRecord` (é a promessa que a resposta crua quebrava), então este teste
// só existe porque o runtime não confia nela — cada helper de leitura tem que
// sobreviver a `parents: undefined`, não só a `parents: []`.
describe("resiliência a `parents` ausente (card não hidratado, ver P0-A)", () => {
  const semParents = { parents: undefined } as unknown as { parents: TaskParentLink[] };

  it("helpers de leitura tratam parents ausente como lista vazia, não como TypeError", () => {
    expect(() => parentIdsOf(semParents)).not.toThrow();
    expect(parentIdsOf(semParents)).toEqual([]);
    expect(hasParent(semParents, "qualquer")).toBe(false);
    expect(slotOf(semParents, "qualquer")).toBeNull();
    expect(stepOrderOf(semParents, "qualquer")).toBe(0);
    expect(planParentIdOf(semParents)).toBeNull();
    expect(deliveryParentIdsOf(semParents)).toEqual([]);
    expect(familyRootIdOf(semParents)).toBeNull();
  });

  it("um card sem parents numa lista não quebra as varreduras por pai — só nunca aparece como filho de ninguém", () => {
    const outro = { id: "outro", parents: [{ id: "p1", slot: null, position: 0 }] };
    const lista = [{ id: "sem-parents", ...semParents }, outro];
    expect(() => childrenOf("p1", lista)).not.toThrow();
    expect(childrenOf("p1", lista)).toEqual([outro]);
    expect(flowStepsOf("p1", lista)).toEqual([]);
    expect(actionPlanMembersOf("p1", lista)).toEqual([outro]);
    expect(childrenByParent(lista).get("p1")).toEqual([outro]);
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
