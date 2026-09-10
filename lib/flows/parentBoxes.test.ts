import { describe, expect, it } from "vitest";
import { relevantParentRelationKinds } from "./parentBoxes";

describe("relações de 'Faz parte de' de um card", () => {
  it("uma etapa comum vê as três relações — entrega, plano e recorrência", () => {
    expect(relevantParentRelationKinds({ isDelivery: false, isPlan: false })).toEqual(["entrega", "plano", "recorrencia"]);
  });

  it("um Plano de Ação nunca tem nenhuma — ele é raiz, nunca filho por este mecanismo", () => {
    expect(relevantParentRelationKinds({ isDelivery: true, isPlan: true })).toEqual([]);
    expect(relevantParentRelationKinds({ isDelivery: false, isPlan: true })).toEqual([]);
  });

  // O caso que ninguém tinha testado: uma entrega-ocorrência de fluxo
  // recorrente (createRecurringFlowDelivery) é flow_parent E filha do molde
  // (recurrence_parent_id) ao mesmo tempo. Ela não é etapa de si mesma (sem
  // "entrega"), mas PRECISA continuar podendo navegar até o molde da
  // recorrência (com "recorrencia") — e até um Plano de Ação, se o fluxo
  // tiver nascido de dentro de um (com "plano"). Excluir isDelivery de
  // "recorrencia" aqui é o que travava "Carregando card pai…" para sempre
  // nesse card, porque o id da recorrência existia mas nenhuma caixa nascia
  // para preenchê-lo.
  it("entrega-ocorrência de fluxo recorrente: sem 'entrega' (ela É a entrega), com 'plano' e 'recorrencia'", () => {
    expect(relevantParentRelationKinds({ isDelivery: true, isPlan: false })).toEqual(["plano", "recorrencia"]);
  });
});
