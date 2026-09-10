import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TaskRecord } from "./validation";

// Mesma família de bug de lib/taskCommentRehydration.test.ts, mas pelo
// caminho de PATCH em vez do de comentário: toda rota interna de
// `routeTaskGroupUpdate` termina num `updateTask` cru (`select(TASK_COLUMNS)`,
// sem os joins de `mergeTaskAssigneeRow`). A rota admin
// (app/api/admin/tasks/[id]/route.ts) já sabia disso e refazia o fetch antes
// de responder — mas a rota do cliente (aprovação/comentário no portal,
// app/api/client/[slug]/tasks/[id]/route.ts) devolvia o retorno de
// `updateTaskGroup` direto, sem `parents`. Corrigido re-hidratando dentro do
// próprio `updateTaskGroup`, o ponto que as duas rotas compartilham.
//
// `detachTaskRelation` tinha o mesmo defeito num dos seus dois desfechos: ao
// desligar uma ocorrência recorrente (branch `recurrencePatch`), devolvia o
// `updateTask` cru em vez de re-hidratar.

// Timeout explícito: estes dois arquivos importam lib/supabase.ts, que puxa o
// grafo inteiro do app (inclusive @react-pdf/renderer, via lib/reports). O
// custo é do IMPORT, não do teste — e sob carga ele passa dos 5s default do
// vitest. Foi exatamente assim que os dois falharam no meio de um
// `npm run verify` (6503ms e 6389ms) e passaram sozinhos logo em seguida:
// flakiness de relógio, não de lógica. Um teste cujo tempo é dominado por
// import não pode viver com o timeout default.
vi.setConfig({ testTimeout: 30_000 });

type QueryResult = { data: unknown; error: unknown };

function selectBuilder(result: QueryResult) {
  const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), limit: vi.fn(() => Promise.resolve(result)) };
  return builder;
}
function updateBuilder(result: QueryResult) {
  const builder = {
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const fromMock = vi.fn();
vi.mock("./supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

function fakeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    client_id: "cliente-1",
    kind: "operacional",
    subtype: null,
    title: "Card em edição",
    status: "em_producao",
    priority: "media",
    assignee: null,
    assignee_profile_ids: [],
    reviewer_id: null,
    approver_id: null,
    plan_id: null,
    parents: [],
    requires_review: false,
    requires_approval: false,
    due_date: null,
    start_date: null,
    end_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    progress_weight: 1,
    description: null,
    client_visible: false,
    payload: {},
    position: 0,
    recurrence_cadence: null,
    recurrence_weekdays: [],
    recurrence_day_of_month: null,
    created_by: null,
    created_by_name: null,
    created_at: "2026-09-01T10:00:00.000Z",
    completed_at: null,
    updated_at: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

const HYDRATED_AFTER_UPDATE = {
  id: "task-1",
  title: "Título editado",
  assignee: null,
  task_assignees: [],
  created_by_profile: null,
  // O elo que só aparece porque getTaskById faz o join — é exatamente o que
  // a resposta crua do UPDATE não carrega.
  task_links: [{ parent_id: "entrega-1", slot: "roteiro", position: 10 }],
};

beforeEach(() => { fromMock.mockReset(); });

describe("updateTaskGroup re-hidrata antes de devolver ao chamador", () => {
  it("a atualização mais simples (sem recorrência, sem entrega) volta com `parents` preenchido", async () => {
    const { updateTaskGroup } = await import("./supabase");
    const current = fakeTask();
    // 1ª chamada a `from`: o UPDATE cru (updateTask). `position` vem definido
    // no patch para não disparar a consulta extra de patchWithTopPosition.
    fromMock.mockReturnValueOnce(updateBuilder({ data: [{ ...current, title: "Título editado" }], error: null }));
    // 2ª chamada: o re-fetch feito por rehydrateOrRaw (getTaskById).
    fromMock.mockReturnValueOnce(selectBuilder({ data: [HYDRATED_AFTER_UPDATE], error: null }));

    const result = await updateTaskGroup("task-1", current, { title: "Título editado", position: 0 });

    expect(result.parents).toEqual([{ id: "entrega-1", slot: "roteiro", position: 10 }]);
  });
});

describe("detachTaskRelation re-hidrata o branch de recorrência", () => {
  it("desligar uma ocorrência recorrente do pai devolve o card re-hidratado, não o UPDATE cru", async () => {
    const { detachTaskRelation } = await import("./supabase");
    const parentId = "recorrencia-pai";
    // getTaskById inicial: o card é a ocorrência (`plan_id` aponta pro pai,
    // metadata de recorrência no payload), sem elo `task_links` para este pai
    // — é o caso que passa pelo branch `recurrencePatch`, não pelo `isLinked`.
    const initialRow = {
      id: "ocorrencia-1",
      plan_id: parentId,
      assignee: null,
      task_assignees: [],
      created_by_profile: null,
      task_links: [],
      payload: { recurrence_parent_id: parentId, recurrence_cycle: 3 },
    };
    fromMock.mockReturnValueOnce(selectBuilder({ data: [initialRow], error: null }));
    // updateTask(taskId, recurrencePatch) — resultado cru, descartado pelo
    // próprio detachTaskRelation (é só o re-fetch que importa).
    fromMock.mockReturnValueOnce(updateBuilder({ data: [{ id: "ocorrencia-1", plan_id: null }], error: null }));
    // rehydrateOrRaw -> getTaskById de novo: a versão pós-patch, já sem o elo
    // de recorrência.
    const refreshedRow = {
      id: "ocorrencia-1",
      plan_id: null,
      assignee: null,
      task_assignees: [],
      created_by_profile: null,
      task_links: [],
      payload: {},
    };
    fromMock.mockReturnValueOnce(selectBuilder({ data: [refreshedRow], error: null }));

    const result = await detachTaskRelation("ocorrencia-1", parentId);

    // Se tivesse voltado a linha crua do UPDATE (ou o `task` capturado antes do
    // patch), `plan_id` ainda seria o do parentId — a prova de que o caminho
    // certo (re-fetch) foi o que decidiu a resposta.
    expect(result.plan_id).toBeNull();
    expect(result.parents).toEqual([]);
  });
});
