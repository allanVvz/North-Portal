import { describe, expect, it } from "vitest";
import { isDeliveryCard, partsLabel, pendingLabel, pendingSteps, stepTotal } from "./parentCounts";

const entrega = (feitas: number, molde: number) => ({
  workflow_version_id: "workflow-v1",
  workflow_version: {
    workflow_version_steps: Array.from({ length: molde }, (_, index) => ({ id: `step-${index}` })),
  },
  activities: Array.from({ length: feitas }, (_, i) => i),
});
const plano = (itens: number) => ({
  activities: Array.from({ length: itens }, (_, i) => i),
});

describe("entrega conta pelo molde, plano conta o que tem", () => {
  // O bug que isto fecha: a view Estratégica mostrava toda entrega como
  // "N atividades", então uma de quatro etapas com só o roteiro pronto
  // parecia um plano de um item — completo.
  it("entrega diz em que etapa está, não quantos cards existem", () => {
    expect(partsLabel(entrega(1, 4))).toBe("etapa 1/4");
    expect(partsLabel(entrega(4, 4))).toBe("etapa 4/4");
  });

  it("plano conta as atividades, e concorda em português", () => {
    expect(partsLabel(plano(1))).toBe("1 atividade");
    expect(partsLabel(plano(3))).toBe("3 atividades");
    expect(partsLabel(plano(0))).toBe("0 atividades");
  });

  it("só entrega tem etapa por nascer", () => {
    expect(pendingSteps(entrega(1, 4))).toBe(3);
    expect(pendingSteps(entrega(4, 4))).toBe(0);
    expect(pendingSteps(plano(1))).toBe(0);
    expect(pendingLabel(plano(1))).toBeNull();
  });

  it("a frase concorda em número", () => {
    expect(pendingLabel(entrega(3, 4))).toBe("Falta 1 etapa");
    expect(pendingLabel(entrega(1, 4))).toBe("Faltam 3 etapas");
    expect(pendingLabel(entrega(4, 4))).toBeNull();
  });

  // O molde é um instantâneo do nascimento. Se alguém acrescentar uma etapa em
  // Configurações › Tipos e fluxos, as entregas em andamento não podem encolher
  // nem crescer no meio do caminho: a FK da versão congela o molde.
  it("sem instantâneo do molde, cai no que existe em vez de mentir", () => {
    const semDefinicao = { workflow_version_id: "workflow-v1", workflow_version: null, activities: [1, 2] };
    expect(stepTotal(semDefinicao)).toBe(2);
    expect(partsLabel(semDefinicao)).toBe("etapa 2/2");
  });

  // Existem cards `criativo` legados, de antes dos fluxos, que não são entrega:
  // a marca está no payload, não no tipo.
  it("card sem a marca de fluxo é plano, mesmo tendo atividades", () => {
    expect(isDeliveryCard(plano(3))).toBe(false);
    expect(isDeliveryCard(entrega(1, 4))).toBe(true);
    expect(isDeliveryCard({ workflow_version_id: null, activities: [] })).toBe(false);
  });
});
