import { describe, expect, it } from "vitest";
import {
  createTaskType,
  deactivationProblem,
  deletionProblem,
  lastStepProblem,
  nextOrderIndex,
  slugifyTypeKey,
  tallyVocabUsage,
  usageKey,
  type TaskTypeEditorNode,
  type TypeWriter,
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
    icon: null,
    tone: null,
    show_in_performance: true,
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

// Fake mínimo de `TypeWriter`: um array em memória por tabela, thenable
// (então `await db.from(...).select(...)` funciona sem envolver Promise de
// verdade), sustentando só as cadeias que createTaskType realmente usa
// (select sem filtro, insert + select + limit, delete + eq). `failStepIndex`
// simula a N-ésima etapa falhando no insert, para provar a limpeza compensatória.
function fakeDb(seedTypes: Record<string, unknown>[] = [], failStepIndex: number | null = null): TypeWriter {
  type FakeTable = "task_types" | "tasks" | "workflow_versions" | "workflow_version_steps";
  const state: Record<FakeTable, Record<string, unknown>[]> = {
    task_types: [
      { id: "operacional", parent_id: null, key: "operacional", label: "Tarefa", order_index: 10, behavior: "simples", creatable: true, active: true },
      ...seedTypes,
    ],
    tasks: [],
    workflow_versions: [],
    workflow_version_steps: [],
  };
  let insertCount = -1; // -1 = a próxima insert é a linha de topo; 0+ = índice da etapa

  function builder(table: FakeTable) {
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let insertPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    let failThis = false;
    const filters: { col: string; val: unknown }[] = [];

    const api = {
      select() { return api; },
      insert(payload: Record<string, unknown>) {
        mode = "insert";
        if (table === "task_types" && payload.parent_id !== null && payload.parent_id !== undefined) {
          insertCount += 1;
          if (failStepIndex !== null && insertCount === failStepIndex) failThis = true;
        }
        insertPayload = { id: `row-${state[table].length + 1}`, active: true, ...payload };
        return api;
      },
      update(payload: Record<string, unknown>) { mode = "update"; updatePayload = payload; return api; },
      delete() { mode = "delete"; return api; },
      eq(col: string, val: unknown) { filters.push({ col, val }); return api; },
      order() { return api; },
      range() { return api; },
      limit() { return api; },
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => void) {
        if (mode === "insert") {
          if (failThis) { resolve({ data: null, error: { message: "insercao falhou (simulado)" } }); return; }
          state[table].push(insertPayload!);
          resolve({ data: [insertPayload], error: null });
          return;
        }
        if (mode === "delete") {
          const doomed = state[table].filter((r) => filters.every((f) => r[f.col] === f.val));
          const doomedIds = new Set(doomed.map((r) => r.id));
          // Simula o `on delete cascade` de task_types.parent_id — a etapa
          // já inserida some junto quando a linha de topo é apagada.
          state[table] = state[table].filter((r) => !doomedIds.has(r.id) && !doomedIds.has(r.parent_id));
          resolve({ data: null, error: null });
          return;
        }
        if (mode === "update") {
          for (const row of state[table]) {
            if (filters.every((f) => row[f.col] === f.val)) Object.assign(row, updatePayload);
          }
          resolve({ data: null, error: null });
          return;
        }
        const rows = state[table].filter((r) => filters.every((f) => r[f.col] === f.val));
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table as FakeTable) } as unknown as TypeWriter;
}

const baseCreateInput = {
  label: "Reels",
  behavior: "entrega" as const,
  icon: "▶",
  tone: "purple" as const,
  show_in_performance: true,
  steps: [{ label: "Roteiro" }, { label: "Gravação" }, { label: "Corte" }],
};

describe("createTaskType — nasce um tipo de topo novo", () => {
  it("cria a linha de topo e as etapas na ordem enviada", async () => {
    const db = fakeDb();
    const created = await createTaskType(db, baseCreateInput);
    expect(created.key).toBe("reels");
    expect(created.icon).toBe("▶");
    expect(created.tone).toBe("purple");
    expect(created.subtypes.map((s) => s.key)).toEqual(["roteiro", "gravacao", "corte"]);
    expect(created.subtypes.map((s) => s.order_index)).toEqual([10, 20, 30]);
  });

  it("recusa um tipo cuja key já existe", async () => {
    const db = fakeDb([{ id: "t1", parent_id: null, key: "reels", label: "Reels", active: true, behavior: "entrega" }]);
    await expect(createTaskType(db, baseCreateInput)).rejects.toThrow(/já existe/i);
  });

  it("recusa etapas com a mesma key entre si, antes de inserir qualquer coisa", async () => {
    const db = fakeDb();
    const input = { ...baseCreateInput, steps: [{ label: "Corte" }, { label: "Corte" }] };
    await expect(createTaskType(db, input)).rejects.toThrow(/mesma chave/i);
  });

  it("se uma etapa falha no meio, apaga a linha de topo (limpeza compensatória)", async () => {
    const db = fakeDb([], 1); // a 2ª etapa (índice 1) falha
    await expect(createTaskType(db, baseCreateInput)).rejects.toThrow(/simulado/);
    const { data } = (await db.from("task_types").select()) as { data: unknown[] };
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ key: "operacional" });
  });
});
