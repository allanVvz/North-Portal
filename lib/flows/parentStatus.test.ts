import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@/lib/validation";
import { currentFlowStepOf } from "./currentStep";
import {
  DELIVERY_INITIAL_STATUS,
  deliveryIsFinished,
  mirroredParentAssignee,
  mirroredParentDate,
  mirroredParentStatus,
  projectParentStatus,
  type ParentStatusTask,
} from "./parentStatus";

describe("ciclo de vida do card-entrega", () => {
  it("nasce em Entrada junto da primeira etapa", () => {
    expect(DELIVERY_INITIAL_STATUS).toBe("backlog");
  });
});

describe("projectParentStatus — uma regra para Plano, Entrega e Rotina", () => {
  let sequence = 0;
  const child = (status: TaskStatus, completed = status === "aprovado") => ({
    id: `child-${sequence++}`, kind: "operacional", status, completed_at: completed ? "2026-09-01T00:00:00Z" : null,
    workflow_version_id: null, workflow_version: null, recurrence_cadence: null, payload: {},
  });
  const plan = { ...child("backlog", false), kind: "plano_acao" };

  it("prioriza a pendência operacional mais relevante de itens paralelos", () => {
    expect(projectParentStatus<ParentStatusTask>(plan, [child("backlog"), child("em_producao")])).toBe("em_producao");
    expect(projectParentStatus<ParentStatusTask>(plan, [child("aprovacao"), child("revisao")])).toBe("revisao");
    expect(projectParentStatus<ParentStatusTask>(plan, [child("parada"), child("revisao")])).toBe("parada");
  });

  it("só conclui o plano quando todos os itens concluíram", () => {
    expect(projectParentStatus<ParentStatusTask>(plan, [child("aprovado"), child("aprovado")])).toBe("aprovado");
    expect(projectParentStatus<ParentStatusTask>(plan, [child("aprovado"), child("backlog")])).toBe("backlog");
    expect(projectParentStatus<ParentStatusTask>({ ...plan, status: "aprovado" }, [])).toBe("backlog");
  });

  it("uma entrega espelha exclusivamente a etapa corrente", () => {
    const delivery = {
      ...child("backlog", false), kind: "criativo", workflow_version_id: "workflow-v1",
      workflow_version: { id: "workflow-v1", workflow_version_steps: [{ id: "one", progress_weight: 1 }, { id: "two", progress_weight: 1 }] },
    };
    expect(projectParentStatus<ParentStatusTask>(delivery, [child("aprovado"), child("revisao")])).toBe("revisao");
    expect(projectParentStatus<ParentStatusTask>(delivery, [child("aprovado")])).toBe("backlog");
  });

  it("rotina ignora histórico concluído e usa a ocorrência aberta atual", () => {
    const routine = { ...child("backlog", false), recurrence_cadence: "semanal" as const, payload: { recurrence_group: true } };
    expect(projectParentStatus<ParentStatusTask>(routine, [child("aprovado"), child("em_producao")])).toBe("em_producao");
  });
});

describe("quando uma entrega está pronta", () => {
  const done = { completed_at: "2026-08-28T12:00:00Z" };
  const open = { completed_at: null };

  it("exige que TODAS as etapas do tipo existam, não só as criadas", () => {
    // Três etapas prontas de um tipo de quatro: a quarta ainda vai nascer.
    expect(deliveryIsFinished([done, done, done], 4)).toBe(false);
    expect(deliveryIsFinished([done, done, done, done], 4)).toBe(true);
  });

  it("não fecha com uma etapa em aberto", () => {
    expect(deliveryIsFinished([done, open], 2)).toBe(false);
  });

  it("não fecha uma entrega sem etapa nenhuma", () => {
    expect(deliveryIsFinished([], 4)).toBe(false);
    expect(deliveryIsFinished([], 0)).toBe(false);
  });
});

// P1-C, regra 2: o status que o card PAI mostra é o da etapa corrente — a
// mais antiga ainda em aberto — nunca um status próprio da entrega.
//
// `mirroredParentStatus` (e as demais `mirroredParent*`) não varre mais a
// lista sozinha — recebem a etapa já resolvida por `currentFlowStepOf`. Os
// testes aqui compõem os dois para continuar provando o comportamento
// ponta-a-ponta, sem duplicar a cobertura de `currentFlowStepOf` (que já tem
// seus próprios testes em currentStep.test.ts).
describe("mirroredParentStatus — o pai mostra a etapa em que a corrente está", () => {
  const doneAt = "2026-09-01T00:00:00Z";
  const done = (status: "aprovado") => ({ status, completed_at: doneAt });
  const open = (status: "backlog" | "em_producao" | "revisao" | "aprovacao") => ({ status, completed_at: null });
  const mirrored = (steps: { status: TaskStatus; completed_at: string | null }[]) =>
    mirroredParentStatus(currentFlowStepOf(steps));

  it("nenhuma etapa ainda: não há o que espelhar", () => {
    expect(mirrored([])).toBeNull();
  });

  it("roteiro em produção, sem próxima etapa: pai mostra produção", () => {
    expect(mirrored([open("em_producao")])).toBe("em_producao");
  });

  it("roteiro em revisão: pai mostra revisão, mesmo com o card ainda por aprovar", () => {
    expect(mirrored([open("revisao")])).toBe("revisao");
  });

  // O exemplo do usuário: roteiro concluído + captação recém-nascida em
  // Entrada → o pai deixa de mostrar revisão/aprovação e VOLTA para Entrada.
  // É essa queda que o teste de monotonicidade em flowProgress.test.ts prova
  // não arrastar o progresso para baixo.
  it("roteiro concluído e captação em Entrada: pai mostra Entrada, não o status antigo do roteiro", () => {
    expect(mirrored([done("aprovado"), open("backlog")])).toBe("backlog");
  });

  it("etapa do meio ainda aberta: pai mostra ela, não a mais recente criada", () => {
    // Corrente fora de ordem só acontece com reabertura manual, mas a função
    // não assume "a mais recente" — ela pega a MAIS ANTIGA ainda aberta.
    expect(mirrored([done("aprovado"), open("em_producao"), open("backlog")])).toBe("em_producao");
  });

  it("todas concluídas: pai mostra a última — a corrente terminou", () => {
    expect(mirrored([done("aprovado"), done("aprovado")])).toBe("aprovado");
  });
});

describe("mirroredParentDate — mostra a data da etapa consultada", () => {
  it("nenhuma etapa: não há o que espelhar", () => {
    expect(mirroredParentDate(null)).toBeNull();
  });

  it("espelha as três datas da etapa corrente", () => {
    const step = { start_date: "2026-09-10", due_date: "2026-09-12", end_date: null };
    expect(mirroredParentDate(step)).toEqual({ start_date: "2026-09-10", due_date: "2026-09-12", end_date: null });
  });
});

describe("mirroredParentAssignee — mostra o responsável da etapa consultada", () => {
  it("nenhuma etapa: não há o que espelhar", () => {
    expect(mirroredParentAssignee(null)).toBeNull();
  });

  it("espelha o responsável (texto livre e vínculos) da etapa corrente", () => {
    const step = { assignee: "Allan", assignee_profile_ids: ["allan-id"] };
    expect(mirroredParentAssignee(step)).toEqual({ assignee: "Allan", assigneeProfileIds: ["allan-id"] });
  });
});
