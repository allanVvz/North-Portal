import { describe, expect, it } from "vitest";
import { DELIVERY_INITIAL_STATUS, deliveryIsFinished, deliveryStatusOnFinish } from "./parentStatus";

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
    expect(deliveryStatusOnFinish({ reviewer_id: null, approver_id: null })).toBe("concluido");
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
