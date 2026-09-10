import { describe, expect, it } from "vitest";
import { DELIVERY_INITIAL_STATUS, deliveryIsFinished, deliveryStatusOnFinish, mirroredParentStatus } from "./parentStatus";

describe("ciclo de vida do card-entrega", () => {
  it("nasce em produção — ela não aparece no quadro para alguém arrastar", () => {
    expect(DELIVERY_INITIAL_STATUS).toBe("em_producao");
  });

  // Revisão antes de Aprovação porque as duas etapas têm donos diferentes:
  // revisor é interno, aprovador é o cliente. Ir direto para Aprovação
  // colocaria na frente do cliente material que ninguém da North olhou.
  it("entra no funil de conferência se houver quem confira", () => {
    expect(deliveryStatusOnFinish({ reviewer_id: "rev", approver_id: "apr" })).toBe("revisao");
    expect(deliveryStatusOnFinish({ reviewer_id: null, approver_id: "apr" })).toBe("aprovacao");
    expect(deliveryStatusOnFinish({ reviewer_id: "rev", approver_id: null })).toBe("revisao");
  });

  it("encerra direto quando não há revisor nem aprovador", () => {
    expect(deliveryStatusOnFinish({ reviewer_id: null, approver_id: null })).toBe("aprovado");
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
describe("mirroredParentStatus — o pai mostra a etapa em que a corrente está", () => {
  const doneAt = "2026-09-01T00:00:00Z";
  const done = (status: "aprovado") => ({ status, completed_at: doneAt });
  const open = (status: "backlog" | "em_producao" | "revisao" | "aprovacao") => ({ status, completed_at: null });

  it("nenhuma etapa ainda: não há o que espelhar", () => {
    expect(mirroredParentStatus([])).toBeNull();
  });

  it("roteiro em produção, sem próxima etapa: pai mostra produção", () => {
    expect(mirroredParentStatus([open("em_producao")])).toBe("em_producao");
  });

  it("roteiro em revisão: pai mostra revisão, mesmo com o card ainda por aprovar", () => {
    expect(mirroredParentStatus([open("revisao")])).toBe("revisao");
  });

  // O exemplo do usuário: roteiro concluído + captação recém-nascida em
  // Entrada → o pai deixa de mostrar revisão/aprovação e VOLTA para Entrada.
  // É essa queda que o teste de monotonicidade em flowProgress.test.ts prova
  // não arrastar o progresso para baixo.
  it("roteiro concluído e captação em Entrada: pai mostra Entrada, não o status antigo do roteiro", () => {
    expect(mirroredParentStatus([done("aprovado"), open("backlog")])).toBe("backlog");
  });

  it("etapa do meio ainda aberta: pai mostra ela, não a mais recente criada", () => {
    // Corrente fora de ordem só acontece com reabertura manual, mas a função
    // não assume "a mais recente" — ela pega a MAIS ANTIGA ainda aberta.
    expect(mirroredParentStatus([done("aprovado"), open("em_producao"), open("backlog")])).toBe("em_producao");
  });

  it("todas concluídas: pai mostra a última — a corrente terminou", () => {
    expect(mirroredParentStatus([done("aprovado"), done("aprovado")])).toBe("aprovado");
  });
});
