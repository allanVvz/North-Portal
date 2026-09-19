import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTaskDb } from "@/lib/testing/fakeTaskDb";
import { createFakeTaskDb } from "@/lib/testing/fakeTaskDb";

// A rota de comentário da Entrega. O que se prova é ONDE o comentário é
// persistido (sempre na tarefa filha), que retry e clique duplo não duplicam nem
// repetem efeitos, e que ambiguidade vira erro rastreável em vez de palpite.

// A rota importa next/server e o grafo de validação; sob a suíte inteira o import
// passa dos 5s padrão.
vi.setConfig({ testTimeout: 30_000 });

const hooks = vi.hoisted(() => ({
  db: null as unknown as FakeTaskDb,
  notifyParticipants: vi.fn(),
  trafficHook: vi.fn(),
  feedbackHook: vi.fn(),
  conversionHook: vi.fn(),
  markParada: vi.fn(),
  afterQueue: [] as Array<() => Promise<void>>,
}));

// `after` só existe dentro de um request do Next. Aqui ele enfileira, e o teste decide
// quando "descarregar" — é o que prova que a resposta sai ANTES do trabalho pesado.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<void>) => { hooks.afterQueue.push(task); } };
});
vi.mock("@/lib/supabase/auth", () => ({ requireAdmin: async () => ({ userId: "user-1", email: "allan@north.test" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => hooks.db }));
vi.mock("@/lib/supabase", async () => {
  const { HttpError } = await import("@/lib/validation");
  return {
    appendTaskComment: async (taskId: string, authorId: string, text: string, commentId: string | null) => {
      const { data } = await hooks.db.rpc("append_task_comment_idempotent", { p_task_id: taskId, p_author_id: authorId, p_text: text, p_comment_id: commentId });
      const result = data as { inserted: boolean; task: Record<string, unknown> } | null;
      if (!result) throw new HttpError(404, "Tarefa não encontrada.");
      return { task: result.task, inserted: result.inserted };
    },
    deleteTaskComment: async (taskId: string) => hooks.db.task(taskId),
    editTaskComment: async (taskId: string) => hooks.db.task(taskId),
    getProfileName: async () => "Allan",
    getTaskById: async (id: string) => hooks.db.task(id) ?? null,
    listTeamMembers: async () => [],
    mentionsName: () => false,
  };
});
vi.mock("@/lib/notifications", () => ({
  notifyProfiles: vi.fn(),
  notifyTaskParticipants: hooks.notifyParticipants,
  taskCommentedMessage: () => "comentou",
}));
vi.mock("@/lib/automations/run", () => ({ handleTrafficRevisionComment: hooks.trafficHook }));
vi.mock("@/lib/automations/conversionFlow", () => ({ recordFeedbackMetricComment: hooks.feedbackHook, handleConversionRevisionComment: hooks.conversionHook }));
vi.mock("@/lib/automations/errorHandling", () => ({ markTaskParada: hooks.markParada }));

import { DELETE, PATCH, POST } from "./route";

const ENTREGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRAFEGO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FEEDBACK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONVERSAO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTRA_ENTREGA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTRA_ETAPA = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const step = (id: string, title: string, status: string) => ({
  id,
  title,
  kind: "operacional",
  subtype: id === CONVERSAO ? "relatorio_conversao" : id === FEEDBACK ? "feedback" : id === TRAFEGO ? "relatorio_anuncios" : undefined,
  status,
  payload: { comments: [] },
});
const link = (parent: string, child: string, position: number) => ({ parent_id: parent, child_id: child, relation_kind: "workflow_step", workflow_step_id: `ws-${position}`, slot: `slot-${position}`, position });

/** Entrega de Automação; `steps` são as etapas já materializadas, em ordem. */
function seed(steps: Array<{ id: string; title: string; status: string }>) {
  hooks.db = createFakeTaskDb({
    tasks: [
      { id: ENTREGA, title: "Entrega", kind: "automacao", status: "revisao", workflow_version_id: "wv", payload: { comments: [] } },
      { id: OUTRA_ENTREGA, title: "Outra entrega", kind: "automacao", status: "backlog", workflow_version_id: "wv", payload: { comments: [] } },
      { id: OUTRA_ETAPA, title: "Etapa alheia", kind: "operacional", status: "backlog", payload: { comments: [] } },
      ...steps.map((s) => step(s.id, s.title, s.status)),
    ],
    task_links: [
      ...steps.map((s, index) => link(ENTREGA, s.id, (index + 1) * 10)),
      link(OUTRA_ENTREGA, OUTRA_ETAPA, 10),
    ],
  });
}

async function post(id: string, body: Record<string, unknown>) {
  const response = await POST(
    new Request(`http://localhost/api/admin/tasks/${id}/comments`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function patchComment(id: string, body: Record<string, unknown>) {
  const response = await PATCH(
    new Request(`http://localhost/api/admin/tasks/${id}/comments`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function deleteComment(id: string, body: Record<string, unknown>) {
  const response = await DELETE(
    new Request(`http://localhost/api/admin/tasks/${id}/comments`, { method: "DELETE", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Executa o que a rota deixou para depois da resposta. */
async function flushAfter() {
  const queued = hooks.afterQueue.splice(0);
  await Promise.all(queued.map((task) => task()));
}

const commentsOn = (id: string) => hooks.db.comments(id).map((c) => c.text);
const allCommentTexts = () => [ENTREGA, TRAFEGO, FEEDBACK, CONVERSAO, OUTRA_ENTREGA, OUTRA_ETAPA].flatMap((id) => commentsOn(id));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.afterQueue.length = 0;
});

describe("comentário na etapa de tráfego da Entrega", () => {
  beforeEach(() => seed([{ id: TRAFEGO, title: "Tráfego", status: "revisao" }]));

  it("stage_task_id explícito: grava na tarefa filha de tráfego e em mais nenhum lugar", async () => {
    const result = await post(ENTREGA, { text: "está aprovado", comment_id: "cid-00000001", stage_task_id: TRAFEGO });

    expect(result.status).toBe(200);
    expect(result.body.id).toBe(TRAFEGO);
    expect(commentsOn(TRAFEGO)).toEqual(["está aprovado"]);
    expect(commentsOn(ENTREGA)).toEqual([]);
    expect(commentsOn(FEEDBACK)).toEqual([]);
    expect(allCommentTexts()).toHaveLength(1);
    // A resposta sai ANTES do trabalho pesado (regerar PDF): o comentário aparece
    // na hora e nada foi disparado ainda.
    expect(hooks.trafficHook).not.toHaveBeenCalled();
    await flushAfter();
    // Os gatilhos leem o id EFETIVO (a etapa), não o da URL.
    expect(hooks.trafficHook).toHaveBeenCalledWith(hooks.db, TRAFEGO);
    expect(hooks.notifyParticipants).toHaveBeenCalledWith(TRAFEGO, "task_commented", "comentou");
  });

  it("chamada antiga sem stage_task_id, com uma única etapa atual: cai nela", async () => {
    const result = await post(ENTREGA, { text: "o primeiro relatório está correto" });

    expect(result.body.id).toBe(TRAFEGO);
    expect(commentsOn(TRAFEGO)).toEqual(["o primeiro relatório está correto"]);
    expect(commentsOn(ENTREGA)).toEqual([]);
  });

  it("retry com o mesmo comment_id: um comentário só e os efeitos não se repetem", async () => {
    const body = { text: "está aprovado", comment_id: "cid-00000002", stage_task_id: TRAFEGO };
    await post(ENTREGA, body);
    const retry = await post(ENTREGA, body);

    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(TRAFEGO);
    expect(commentsOn(TRAFEGO)).toEqual(["está aprovado"]);
    await flushAfter();
    expect(hooks.notifyParticipants).toHaveBeenCalledTimes(1);
    expect(hooks.trafficHook).toHaveBeenCalledTimes(1);
    expect(hooks.feedbackHook).toHaveBeenCalledTimes(1);
  });

  it("clique duplo (duas requisições simultâneas com o mesmo id): um comentário só", async () => {
    const body = { text: "está aprovado", comment_id: "cid-00000003", stage_task_id: TRAFEGO };
    const [first, second] = await Promise.all([post(ENTREGA, body), post(ENTREGA, body)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(commentsOn(TRAFEGO)).toEqual(["está aprovado"]);
    await flushAfter();
    expect(hooks.notifyParticipants).toHaveBeenCalledTimes(1);
    expect(hooks.trafficHook).toHaveBeenCalledTimes(1);
  });

  it("mesmo texto com OUTRO comment_id é outro comentário (não é retry)", async () => {
    await post(ENTREGA, { text: "ok", comment_id: "cid-00000004", stage_task_id: TRAFEGO });
    await post(ENTREGA, { text: "ok", comment_id: "cid-00000005", stage_task_id: TRAFEGO });
    expect(commentsOn(TRAFEGO)).toEqual(["ok", "ok"]);
  });

  it("falha num gatilho não vira 500 nem perde o comentário: a etapa é parada com aviso", async () => {
    hooks.trafficHook.mockRejectedValueOnce(new Error("Windsor fora do ar"));

    const result = await post(ENTREGA, { text: "troque a capa", comment_id: "cid-00000006", stage_task_id: TRAFEGO });

    expect(result.status).toBe(200);
    expect(commentsOn(TRAFEGO)).toEqual(["troque a capa"]);
    await flushAfter();
    expect(hooks.markParada).toHaveBeenCalledWith(hooks.db, TRAFEGO, expect.stringContaining("Windsor fora do ar"));
  });
});

describe("comentário na etapa de feedback da Entrega", () => {
  beforeEach(() => seed([
    { id: TRAFEGO, title: "Tráfego", status: "aprovado" },
    { id: FEEDBACK, title: "Feedback", status: "em_producao" },
  ]));

  it("tráfego concluído e feedback ativo: grava na filha de feedback, nunca em tráfego, conversão ou pai", async () => {
    const result = await post(ENTREGA, { text: "Vendas: 5\nAgendamentos: 8", comment_id: "cid-00000010", stage_task_id: FEEDBACK });

    expect(result.body.id).toBe(FEEDBACK);
    expect(commentsOn(FEEDBACK)).toEqual(["Vendas: 5\nAgendamentos: 8"]);
    expect(commentsOn(TRAFEGO)).toEqual([]);
    expect(commentsOn(CONVERSAO)).toEqual([]);
    expect(commentsOn(ENTREGA)).toEqual([]);
    await flushAfter();
    expect(hooks.feedbackHook).toHaveBeenCalledWith(hooks.db, FEEDBACK);
  });

  it("sem stage_task_id, a única etapa aberta (feedback) recebe", async () => {
    const result = await post(ENTREGA, { text: "Vendas: 5" });
    expect(result.body.id).toBe(FEEDBACK);
    expect(commentsOn(TRAFEGO)).toEqual([]);
  });

  // Só se comenta no pai: se a tela ainda mostrava o tráfego como corrente mas o
  // feedback já abriu (outra aba aprovou), o comentário é da etapa de AGORA.
  it("tela desatualizada (ainda mostra tráfego, feedback já abriu): o comentário vai para o feedback, nunca para uma etapa concluída", async () => {
    const result = await post(ENTREGA, { text: "Vendas: 5", comment_id: "cid-00000011", stage_task_id: TRAFEGO });
    expect(result.body.id).toBe(FEEDBACK);
    expect(commentsOn(FEEDBACK)).toEqual(["Vendas: 5"]);
    expect(commentsOn(TRAFEGO)).toEqual([]);
    expect(commentsOn(ENTREGA)).toEqual([]);
    await flushAfter();
    expect(hooks.feedbackHook).toHaveBeenCalledWith(hooks.db, FEEDBACK);
  });

  it("comentar diretamente na linha da etapa concluída (URL da etapa) continua gravando nela", async () => {
    const result = await post(TRAFEGO, { text: "nota sobre o relatório já aprovado" });
    expect(result.body.id).toBe(TRAFEGO);
    expect(commentsOn(TRAFEGO)).toEqual(["nota sobre o relatório já aprovado"]);
  });
});

describe("roteamento ambíguo ou inválido", () => {
  it("chamada antiga sem stage_task_id e com duas etapas abertas: 409 rastreável e NADA é gravado", async () => {
    seed([
      { id: TRAFEGO, title: "Tráfego", status: "revisao" },
      { id: FEEDBACK, title: "Feedback", status: "em_producao" },
    ]);

    const result = await post(ENTREGA, { text: "oi" });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("COMMENT_STAGE_AMBIGUOUS");
    expect((result.body.candidates as string[]).sort()).toEqual([TRAFEGO, FEEDBACK].sort());
    expect(allCommentTexts()).toEqual([]);
    expect(hooks.notifyParticipants).not.toHaveBeenCalled();
  });

  it("com duas etapas abertas, o stage_task_id resolve a ambiguidade", async () => {
    seed([
      { id: TRAFEGO, title: "Tráfego", status: "revisao" },
      { id: FEEDBACK, title: "Feedback", status: "em_producao" },
    ]);
    const result = await post(ENTREGA, { text: "oi", stage_task_id: FEEDBACK });
    expect(result.status).toBe(200);
    expect(commentsOn(FEEDBACK)).toEqual(["oi"]);
  });

  it("stage_task_id de OUTRA entrega: 409 e nada é gravado", async () => {
    seed([{ id: TRAFEGO, title: "Tráfego", status: "revisao" }]);

    const result = await post(ENTREGA, { text: "oi", stage_task_id: OUTRA_ETAPA });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("COMMENT_STAGE_INVALID");
    expect(allCommentTexts()).toEqual([]);
  });

  it("o id da própria entrega não vale como etapa: nunca grava no pai", async () => {
    seed([{ id: TRAFEGO, title: "Tráfego", status: "revisao" }]);
    const result = await post(ENTREGA, { text: "oi", stage_task_id: ENTREGA });
    expect(result.status).toBe(409);
    expect(commentsOn(ENTREGA)).toEqual([]);
  });

  it("comentar direto numa tarefa comum (ou numa etapa) grava nela mesma", async () => {
    seed([{ id: TRAFEGO, title: "Tráfego", status: "revisao" }]);
    const result = await post(TRAFEGO, { text: "direto na etapa" });
    expect(result.body.id).toBe(TRAFEGO);
    expect(commentsOn(TRAFEGO)).toEqual(["direto na etapa"]);
  });

  it("comentário direto na conversão dispara a regeneração idempotente", async () => {
    seed([{ id: CONVERSAO, title: "Conversão", status: "revisao" }]);
    const result = await post(CONVERSAO, { text: "gere outro relatório", comment_id: "cid-conversion-01" });
    expect(result.body.id).toBe(CONVERSAO);
    await flushAfter();
    expect(hooks.conversionHook).toHaveBeenCalledWith(hooks.db, CONVERSAO);
  });

  it("edição e exclusão também reprocessam o card de conversão", async () => {
    seed([{ id: CONVERSAO, title: "Conversão", status: "revisao" }]);

    const edited = await patchComment(CONVERSAO, { index: 0, at: "2026-09-18T10:00:00.000Z", text: "Vendas: 4" });
    expect(edited.status).toBe(200);
    await flushAfter();
    expect(hooks.conversionHook).toHaveBeenCalledWith(hooks.db, CONVERSAO);

    hooks.conversionHook.mockClear();
    const removed = await deleteComment(CONVERSAO, { index: 0, at: "2026-09-18T10:00:00.000Z" });
    expect(removed.status).toBe(200);
    await flushAfter();
    expect(hooks.conversionHook).toHaveBeenCalledWith(hooks.db, CONVERSAO);
  });
});
