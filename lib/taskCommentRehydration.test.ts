import { describe, expect, it, vi, beforeEach } from "vitest";

// P0-A: as RPCs de comentário (append_task_comment/edit_task_comment/
// delete_task_comment, migrações 20260826120000/20260827001000) devolvem
// `returning t.*` — só colunas de `tasks`. `parents` (e assignee_profile_ids/
// created_by_name) não é coluna: é derivado de task_links/task_assignees por
// mergeTaskAssigneeRow, dentro de getTaskById. Sem re-hidratar, o card sem
// `parents` entrava no estado do board e TaskModal.tsx (`t.parents.some`,
// `t.parents.length`) quebrava com TypeError, derrubando a árvore React
// inteira só por comentar (e fazendo a caixa "Faz parte de" sumir no meio
// disso, porque planParentIdOf/deliveryParentIdsOf liam `parents` vazio).
//
// Este teste mocka o cliente Supabase (o RPC e a consulta que getTaskById
// faz por trás) para provar que appendTaskComment/editTaskComment/
// deleteTaskComment agora devolvem o card RE-HIDRATADO — com `parents`
// preenchido — e não a linha crua do RPC, exceto quando o re-fetch falha.

type QueryResult = { data: unknown; error: unknown };

// `.from("tasks").select(...).eq(...).limit(1)` — o formato de getTaskById.
function selectBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("./supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock, from: fromMock })),
}));

// task_links com um elo — é exatamente o dado que a resposta crua do RPC não
// tinha e que fazia `parents` sumir do card.
const HYDRATED_ROW = {
  id: "task-1",
  title: "Etapa comentada",
  assignee: null,
  task_assignees: [],
  created_by_profile: null,
  task_links: [{ parent_id: "entrega-1", slot: "roteiro", position: 10 }],
};

// A linha crua que a RPC de fato devolve hoje: `t.*` puro, sem os joins —
// e por isso sem `parents`, `assignee_profile_ids` nem `created_by_name`.
const RAW_RPC_ROW = { id: "task-1", title: "Etapa comentada", assignee: "Ana" };

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("appendTaskComment re-hidrata antes de devolver ao chamador", () => {
  it("devolve o card com `parents` preenchido, não a linha crua da RPC", async () => {
    const { appendTaskComment } = await import("./supabase");
    rpcMock.mockResolvedValue({ data: [RAW_RPC_ROW], error: null });
    fromMock.mockReturnValueOnce(selectBuilder({ data: [HYDRATED_ROW], error: null }));

    const result = await appendTaskComment("task-1", "author-1", "novo comentário");

    expect(rpcMock).toHaveBeenCalledWith("append_task_comment", {
      p_task_id: "task-1", p_author_id: "author-1", p_text: "novo comentário",
    });
    expect(result.parents).toEqual([{ id: "entrega-1", slot: "roteiro", position: 10 }]);
  });

  it("cai para a linha crua da RPC quando o re-fetch falha — incompleta é melhor que 500 numa ação já persistida", async () => {
    const { appendTaskComment } = await import("./supabase");
    rpcMock.mockResolvedValue({ data: [RAW_RPC_ROW], error: null });
    // getTaskById -> fail() -> lança HttpError; rehydrateOrRaw absorve com .catch.
    fromMock.mockReturnValueOnce(selectBuilder({ data: null, error: { message: "conexão caiu" } }));

    const result = await appendTaskComment("task-1", "author-1", "novo comentário");

    expect(result).toBe(RAW_RPC_ROW);
    expect((result as { parents?: unknown }).parents).toBeUndefined();
  });
});

describe("editTaskComment e deleteTaskComment compartilham a mesma re-hidratação", () => {
  it("editTaskComment devolve o card re-hidratado", async () => {
    const { editTaskComment } = await import("./supabase");
    rpcMock.mockResolvedValue({ data: [RAW_RPC_ROW], error: null });
    fromMock.mockReturnValueOnce(selectBuilder({ data: [HYDRATED_ROW], error: null }));

    const result = await editTaskComment("task-1", 0, "2026-09-01T10:00:00.000Z", "texto editado");
    expect(result.parents).toEqual([{ id: "entrega-1", slot: "roteiro", position: 10 }]);
  });

  it("deleteTaskComment devolve o card re-hidratado", async () => {
    const { deleteTaskComment } = await import("./supabase");
    rpcMock.mockResolvedValue({ data: [RAW_RPC_ROW], error: null });
    fromMock.mockReturnValueOnce(selectBuilder({ data: [HYDRATED_ROW], error: null }));

    const result = await deleteTaskComment("task-1", 0, "2026-09-01T10:00:00.000Z");
    expect(result.parents).toEqual([{ id: "entrega-1", slot: "roteiro", position: 10 }]);
  });
});
