import { describe, expect, it } from "vitest";
import {
  deactivationProblem,
  deletionProblem,
  lastStepProblem,
  nextOrderIndex,
  slugifyTypeKey,
  tallyVocabUsage,
  usageKey,
  type TaskTypeEditorNode,
} from "./taskTypes";

function step(id: string, key: string, active = true) {
  return {
    id,
    key,
    label: key,
    order_index: 10,
    lead_days: 0,
    progress_weight: 1,
    default_assignee: null,
    client_visible: false,
    active,
  };
}

function deliveryType(subtypes: ReturnType<typeof step>[]): TaskTypeEditorNode {
  return {
    id: "t1",
    key: "criativo",
    label: "Criativo",
    order_index: 20,
    behavior: "entrega",
    creatable: true,
    active: true,
    subtypes,
  };
}

describe("uso do vocabulário", () => {
  // A key de subtipo repete entre pais (`publicacao` existe sob dois tipos):
  // contar só pela key faria uma etapa parecer usada por causa de outra.
  it("endereça subtipo com o pai junto", () => {
    const usage = tallyVocabUsage([
      { kind: "criativo", subtype: "publicacao", status: "em_producao" },
      { kind: "agendamento", subtype: "publicacao", status: "em_producao" },
    ]);
    expect(usage[usageKey("criativo", "publicacao")].total).toBe(1);
    expect(usage[usageKey("agendamento", "publicacao")].total).toBe(1);
    expect(usage[usageKey("criativo")].total).toBe(1);
  });

  it("separa histórico de trabalho em aberto", () => {
    const usage = tallyVocabUsage([
      { kind: "criativo", subtype: "roteiro", status: "aprovado" },
      { kind: "criativo", subtype: "roteiro", status: "concluido" },
      { kind: "criativo", subtype: "roteiro", status: "backlog" },
    ]);
    expect(usage[usageKey("criativo", "roteiro")]).toEqual({ total: 3, open: 1 });
  });
});

describe("travas de edição do vocabulário", () => {
  // Desativar tira a linha de listTaskTypes, e é dela que a cascata lê a etapa
  // seguinte: com card em aberto no meio, a corrente pararia em silêncio.
  it("recusa desativar o que tem card em aberto, e libera quando só há histórico", () => {
    expect(deactivationProblem("Edição", { total: 9, open: 2 })).toContain("2 cards em aberto");
    expect(deactivationProblem("Edição", { total: 9, open: 0 })).toBeNull();
    expect(deactivationProblem("Edição", undefined)).toBeNull();
  });

  it("recusa excluir o que já foi usado alguma vez — desativar preserva o histórico", () => {
    expect(deletionProblem("Edição", { total: 1, open: 0 })).toContain("1 card");
    expect(deletionProblem("Edição", { total: 0, open: 0 })).toBeNull();
  });

  it("não deixa uma Entrega ficar sem etapa ativa", () => {
    const type = deliveryType([step("s1", "roteiro"), step("s2", "edicao", false)]);
    expect(lastStepProblem(type, "s1")).toContain("pelo menos uma etapa ativa");
    // Com duas ativas, tirar uma continua deixando cascata de pé.
    expect(lastStepProblem(deliveryType([step("s1", "roteiro"), step("s2", "edicao")]), "s1")).toBeNull();
  });

  it("a trava da última etapa vale só para Entrega — Tarefa/Plano não cascateiam", () => {
    const simples = { ...deliveryType([step("s1", "gestao")]), behavior: "simples" as const };
    expect(lastStepProblem(simples, "s1")).toBeNull();
  });
});

describe("key derivada do rótulo", () => {
  it("normaliza acento, caixa e pontuação", () => {
    expect(slugifyTypeKey("Edição")).toBe("edicao");
    expect(slugifyTypeKey("Copy / legenda")).toBe("copy_legenda");
    expect(slugifyTypeKey("  Apresentação de resultados  ")).toBe("apresentacao_de_resultados");
  });

  it("devolve vazio quando não sobra nada — a rota recusa em vez de gravar uma key ilegível", () => {
    expect(slugifyTypeKey("///")).toBe("");
  });
});

describe("posição de uma etapa nova", () => {
  it("entra no fim da fila com folga para uma inserção manual depois", () => {
    expect(nextOrderIndex([])).toBe(10);
    expect(nextOrderIndex([{ order_index: 10 }, { order_index: 40 }])).toBe(50);
  });
});
