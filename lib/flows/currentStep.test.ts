import { describe, expect, it } from "vitest";
import { currentFlowStepOf } from "./currentStep";

describe("etapa corrente de uma entrega", () => {
  it("sem etapa nenhuma ainda: corrente vazia, quem chama decide o fallback", () => {
    expect(currentFlowStepOf([])).toBeNull();
  });

  it("a primeira etapa aberta é a corrente, mesmo com etapas concluídas antes dela", () => {
    const done = { id: "roteiro", completed_at: "2026-09-01T00:00:00Z" };
    const open = { id: "captacao", completed_at: null };
    const untouched = { id: "edicao", completed_at: null };
    expect(currentFlowStepOf([done, open, untouched])?.id).toBe("captacao");
  });

  it("todas concluídas: a corrente é a ÚLTIMA, não null — ela nunca 'acaba'", () => {
    const a = { id: "roteiro", completed_at: "2026-09-01T00:00:00Z" };
    const b = { id: "publicacao", completed_at: "2026-09-05T00:00:00Z" };
    expect(currentFlowStepOf([a, b])?.id).toBe("publicacao");
  });

  it("etapa parada conta como aberta — é onde a corrente travou, e é ali que o comentário do pai deve cair", () => {
    // Uma etapa em `status: 'parada'` nunca ganha `completed_at` (só o status
    // 'aprovado' carimba isso, ver lib/flows/parentStatus.ts). Esta função não
    // lê `status` de propósito, para não duplicar a definição de "concluído" —
    // mas o caso de negócio real é exatamente este: card travado continua
    // sendo a corrente até alguém destravar.
    const done = { id: "roteiro", completed_at: "2026-09-01T00:00:00Z" };
    const stopped = { id: "captacao", completed_at: null };
    expect(currentFlowStepOf([done, stopped])?.id).toBe("captacao");
  });

  it("respeita a ordem recebida — ordenar é responsabilidade de quem chama (flowStepsOf)", () => {
    const open1 = { id: "b", completed_at: null };
    const open2 = { id: "a", completed_at: null };
    expect(currentFlowStepOf([open1, open2])?.id).toBe("b");
  });

  it("uma única etapa aberta é a corrente, uma única concluída também é (fica sendo a última)", () => {
    expect(currentFlowStepOf([{ id: "x", completed_at: null }])?.id).toBe("x");
    expect(currentFlowStepOf([{ id: "x", completed_at: "2026-09-01T00:00:00Z" }])?.id).toBe("x");
  });
});
