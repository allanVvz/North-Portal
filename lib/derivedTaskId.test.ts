import { describe, expect, it } from "vitest";
import { derivedTaskId } from "./derivedTaskId";
import { recurringExecutionId } from "./recurrence";
import { flowStepTaskId } from "./flows/ids";

describe("derivedTaskId", () => {
  // Valor fixado de propósito. O hash saiu de dentro de recurringExecutionId
  // para ser compartilhado com os fluxos, e ocorrências recorrentes REAIS já
  // existem em produção com ids gerados pela versão antiga: se este número
  // mudar, "concluir ciclo" passa a criar uma execução nova em vez de reencontrar
  // a que já existe, e a idempotência da recorrência morre em silêncio.
  it("mantém o mesmo digest de antes da extração", () => {
    expect(recurringExecutionId("parent-1", 3)).toBe("04023c3e-a28e-55e4-b3dd-44018e7bf787");
    expect(derivedTaskId("parent-1", "cycle:3")).toBe(recurringExecutionId("parent-1", 3));
  });

  it("tem forma de uuid v5", () => {
    expect(flowStepTaskId("entrega-1", "captacao")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("é estável por (pai, identidade) e distinto entre identidades", () => {
    expect(flowStepTaskId("entrega-1", "captacao")).toBe("430403d7-d54c-5edb-bd77-532ff0a24183");
    expect(flowStepTaskId("entrega-1", "edicao")).not.toBe(flowStepTaskId("entrega-1", "captacao"));
    expect(flowStepTaskId("entrega-2", "captacao")).not.toBe(flowStepTaskId("entrega-1", "captacao"));
  });

  // Namespaces separados: uma entrega e um pai recorrente com o mesmo id nunca
  // podem derivar o mesmo filho.
  it("não colide com o namespace da recorrência", () => {
    expect(flowStepTaskId("x", "1")).not.toBe(recurringExecutionId("x", 1));
  });
});
