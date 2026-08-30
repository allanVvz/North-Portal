import { describe, expect, it } from "vitest";
import { FLOW_TOTAL_WEIGHT_KEY, dedupePlanMembers, taskProgress } from "@/lib/taskCatalog";
import type { TaskStatus } from "@/lib/validation";

const step = (status: TaskStatus, id: string = status, progress_weight = 1) =>
  ({ id, kind: "criativo", status, progress_weight, payload: {} });

// A entrega é reconhecida pela marca no payload, não pelo tipo: existem cards
// `criativo` legados que são trabalho comum e não podem virar pais.
const delivery = (totalWeight: number) => ({
  id: "entrega",
  kind: "criativo",
  status: "em_producao" as TaskStatus,
  progress_weight: 1,
  payload: { flow_parent: true, [FLOW_TOTAL_WEIGHT_KEY]: totalWeight },
});

describe("progresso de uma entrega em cascata", () => {
  // O erro que motivou o snapshot: com só a primeira etapa materializada, um
  // rollup sobre "os membros que existem" dá 100% e o cliente vê a peça como
  // pronta antes de existir gravação, edição ou publicação.
  it("conta as etapas que ainda não nasceram no denominador", () => {
    expect(taskProgress(delivery(4), [step("aprovado", "roteiro")])).toBe(25);
  });

  it("chega a 100% só quando todas as etapas do molde existem e terminaram", () => {
    const all = [
      step("aprovado", "roteiro"),
      step("aprovado", "captacao"),
      step("aprovado", "edicao"),
      step("aprovado", "publicacao"),
    ];
    expect(taskProgress(delivery(4), all)).toBe(100);
  });

  it("pondera a etapa parcial pelo peso do molde, não pela contagem de membros", () => {
    // roteiro 100% + captação em produção (35%, agora igual para todo tipo)
    // sobre 4 etapas: 135/4 = 33,75.
    expect(taskProgress(delivery(4), [step("aprovado", "roteiro"), step("em_producao", "captacao")])).toBe(34);
  });

  it("é 0 quando nenhuma etapa foi materializada ainda", () => {
    expect(taskProgress(delivery(4), [])).toBe(0);
  });

  // O snapshot é congelado de propósito: editar o molde não pode reescrever o
  // progresso de entregas que já estão em andamento com outra forma.
  it("usa o peso congelado, e não o molde vigente", () => {
    const frozen = delivery(4);
    expect(taskProgress(frozen, [step("aprovado", "roteiro")])).toBe(25);
  });

  it("cai para o peso dos membros quando o snapshot sumiu (molde apagado)", () => {
    const orphan = { ...delivery(0), payload: { flow_parent: true } };
    expect(taskProgress(orphan, [step("aprovado", "roteiro")])).toBe(100);
  });
});

// A regra de "a Entrega conta como UM item": se alguém ligar também as etapas
// ao mesmo Plano, a peça pesaria cinco vezes na média.
describe("dedupePlanMembers — a peça não conta cinco vezes", () => {
  it("tira do peso a etapa que já pertence a uma Entrega da mesma lista", () => {
    const entrega = delivery(4);
    const roteiro = step("aprovado", "roteiro");
    const avulsa = { id: "avulsa", kind: "operacional", status: "aprovado" as TaskStatus, progress_weight: 1, payload: {} };
    const byParent = new Map([["entrega", [roteiro]]]);

    // Alguém ligou a entrega E o roteiro dela ao mesmo plano.
    const membros = [entrega, roteiro, avulsa];
    expect(dedupePlanMembers(membros, byParent).map((m) => m.id)).toEqual(["entrega", "avulsa"]);
  });

  it("sem o mapa não há o que deduzir, e nada é removido", () => {
    const entrega = delivery(4);
    expect(dedupePlanMembers([entrega], undefined)).toEqual([entrega]);
  });
});

describe("rollup aninhado", () => {
  // Bug pré-existente que a cascata tornaria regra: taskProgress era chamado
  // recursivamente sem os filhos do membro, então um pai dentro de outro pai
  // respondia 0 honestamente e derrubava a média de fora.
  it("resolve uma entrega que é membro de um Plano de Ação", () => {
    const plano = { id: "plano", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const entrega = delivery(4);
    const byParent = new Map([["entrega", [step("aprovado", "roteiro"), step("aprovado", "captacao")]]]);

    expect(taskProgress(plano, [entrega], byParent)).toBe(50);
    // Sem o mapa, o comportamento antigo (0) permanece — nenhum call site quebra.
    expect(taskProgress(plano, [entrega])).toBe(0);
  });

  it("não estoura a pilha com um grafo cíclico", () => {
    const a = { id: "a", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const b = { id: "b", kind: "plano_acao", status: "backlog" as TaskStatus, progress_weight: 1 };
    const byParent = new Map([["a", [b]], ["b", [a]]]);
    expect(() => taskProgress(a, [b], byParent)).not.toThrow();
  });
});
