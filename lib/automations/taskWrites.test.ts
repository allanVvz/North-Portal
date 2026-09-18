import { describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import { automationCommentId, transitionTaskStatus, updateTaskPayload } from "./taskWrites";
import { markTaskParada } from "./errorHandling";

vi.mock("./notify", () => ({
  notifyFromAutomation: vi.fn(async () => undefined),
  notifyResponsibilityHolders: vi.fn(async () => undefined),
}));

const humanComment = (db: ReturnType<typeof createFakeTaskDb>, taskId: string, text: string, commentId?: string) =>
  db.rpc("append_task_comment_idempotent", { p_task_id: taskId, p_author_id: "u1", p_text: text, p_comment_id: commentId ?? null });

function world(extra: Partial<Row> = {}) {
  return createFakeTaskDb({
    tasks: [{ id: "step", status: "em_producao", payload: { comments: [], keep: "sim" }, ...extra }],
  });
}

describe("updateTaskPayload — escrita atômica", () => {
  // Controle: prova que o fake reproduz o defeito antigo. Ler o payload, esperar
  // (a geração do relatório) e regravá-lo inteiro apaga o que foi escrito no
  // meio tempo. Se este teste parar de passar, o fake deixou de modelar a corrida
  // e os testes abaixo não provam mais nada.
  it("CONTROLE — o padrão antigo (ler → esperar → regravar o payload) perde o comentário humano", async () => {
    const db = world();
    const stale = structuredClone(db.task("step")!.payload) as Row;

    await humanComment(db, "step", "Cuidado com a verba");
    await db.from("tasks").update({ payload: { ...stale, comments: [{ author: "Automação", text: "relatório pronto", at: "x" }] } }).eq("id", "step");

    expect(db.comments("step").map((c) => c.text)).toEqual(["relatório pronto"]);
  });

  it("acrescenta o comentário da automação preservando o que um humano gravou depois da leitura", async () => {
    const db = world();
    const admin = db.asAdmin();
    await humanComment(db, "step", "Cuidado com a verba");

    const result = await updateTaskPayload(admin, "step", { text: "Relatório gerado", commentId: automationCommentId("ads-report", "step", 1) });

    expect(result?.inserted).toBe(true);
    expect(db.comments("step").map((c) => c.text)).toEqual(["Cuidado com a verba", "Relatório gerado"]);
  });

  it("mescla só as chaves do patch e não toca no resto do payload", async () => {
    const db = world();
    await updateTaskPayload(db.asAdmin(), "step", { patch: { marker: "x" } });
    const payload = db.task("step")!.payload as Row;
    expect(payload).toMatchObject({ marker: "x", keep: "sim" });
  });

  it("remove só as chaves pedidas", async () => {
    const db = world({ payload: { comments: [], a: 1, b: 2 } });
    await updateTaskPayload(db.asAdmin(), "step", { remove: ["a"] });
    expect(db.task("step")!.payload).toEqual({ comments: [], b: 2 });
  });

  it("é idempotente pelo id: a mesma ação re-executada não repete o comentário", async () => {
    const db = world();
    const id = automationCommentId("ads-report", "step", 1);
    const first = await updateTaskPayload(db.asAdmin(), "step", { text: "Relatório gerado", commentId: id });
    const second = await updateTaskPayload(db.asAdmin(), "step", { text: "Relatório gerado", commentId: id, patch: { marker: "novo" } });

    expect(first?.inserted).toBe(true);
    expect(second?.inserted).toBe(false);
    expect(db.comments("step")).toHaveLength(1);
    // O patch ainda vale no retry: só o comentário é deduplicado.
    expect((db.task("step")!.payload as Row).marker).toBe("novo");
  });

  it("duas chamadas concorrentes com o mesmo id gravam um comentário só", async () => {
    const db = world();
    const id = automationCommentId("feedback-prompt", "step");
    const results = await Promise.all([
      updateTaskPayload(db.asAdmin(), "step", { text: "Como foi a semana?", commentId: id }),
      updateTaskPayload(db.asAdmin(), "step", { text: "Como foi a semana?", commentId: id }),
    ]);
    expect(results.filter((r) => r?.inserted)).toHaveLength(1);
    expect(db.comments("step")).toHaveLength(1);
  });

  it("recusa mexer no thread por patch/remove (só comentário muda `comments`)", async () => {
    const db = world();
    await expect(updateTaskPayload(db.asAdmin(), "step", { patch: { comments: [] } })).rejects.toBeTruthy();
    await expect(updateTaskPayload(db.asAdmin(), "step", { remove: ["comments"] })).rejects.toBeTruthy();
  });

  it("mantém os 200 comentários mais recentes", async () => {
    const seed = Array.from({ length: 200 }, (_, index) => ({ author: "x", text: `c${index}`, at: "t" }));
    const db = world({ payload: { comments: seed } });
    await updateTaskPayload(db.asAdmin(), "step", { text: "novo" });
    const thread = db.comments("step");
    expect(thread).toHaveLength(200);
    expect(thread[0].text).toBe("c1");
    expect(thread.at(-1)?.text).toBe("novo");
  });

  it("devolve null quando a tarefa não existe", async () => {
    expect(await updateTaskPayload(world().asAdmin(), "nao-existe", { text: "oi" })).toBeNull();
  });
});

describe("automationCommentId", () => {
  // A RPC recusa id fora de 8–128 caracteres; um id longo derrubaria a geração
  // do relatório em vez de só deduplicar o comentário.
  it("os ids reais das ações ficam dentro do limite da RPC", () => {
    const card = "3ef6940d-43f6-5fe7-a8a4-1fcf6b7c197d";
    const ids = [
      automationCommentId("ads-report", card, 12),
      automationCommentId("ads-revision", card, 12),
      automationCommentId("feedback-prompt", card),
      automationCommentId("conversion-summary", card, card),
      automationCommentId("sales-report", card, "2026-09-20"),
      automationCommentId("feedback-format", card, "2026-09-21 12:00:00.123456+00"),
    ];
    for (const id of ids) {
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });
});

describe("transitionTaskStatus — compare-and-set", () => {
  it("move quando o estado de origem confere", async () => {
    const db = world();
    const moved = await transitionTaskStatus(db.asAdmin(), "step", { to: "revisao", from: ["em_producao"] });
    expect(moved?.status).toBe("revisao");
  });

  it("CONTROLE — o UPDATE incondicional reabre uma etapa que uma pessoa concluiu (o trigger limpa completed_at)", async () => {
    const db = world();
    await db.from("tasks").update({ status: "aprovado" }).eq("id", "step");
    expect(db.task("step")!.completed_at).toBeTruthy();

    await db.from("tasks").update({ status: "revisao" }).eq("id", "step");
    expect(db.task("step")!.completed_at).toBeNull();
  });

  it("execução antiga: uma pessoa concluiu no meio tempo → a transição atrasada não rebaixa a etapa", async () => {
    const db = world();
    await db.from("tasks").update({ status: "aprovado" }).eq("id", "step");

    const moved = await transitionTaskStatus(db.asAdmin(), "step", { to: "revisao", from: ["em_producao"] });

    expect(moved).toBeNull();
    expect(db.task("step")!.status).toBe("aprovado");
    expect(db.task("step")!.completed_at).toBeTruthy();
  });

  it("`unless` e `open` recusam etapa já concluída", async () => {
    const db = world();
    await db.from("tasks").update({ status: "aprovado" }).eq("id", "step");
    expect(await transitionTaskStatus(db.asAdmin(), "step", { to: "parada", unless: ["parada", "aprovado"] })).toBeNull();
    expect(await transitionTaskStatus(db.asAdmin(), "step", { to: "revisao", open: true })).toBeNull();
    expect(db.task("step")!.status).toBe("aprovado");
  });

  it("escreve as colunas extras no mesmo UPDATE", async () => {
    const db = world();
    await transitionTaskStatus(db.asAdmin(), "step", { to: "revisao", from: ["em_producao"], extra: { assignee: "North Ai" } });
    expect(db.task("step")).toMatchObject({ status: "revisao", assignee: "North Ai" });
  });
});

describe("markTaskParada", () => {
  it("para uma etapa em andamento, comenta e guarda o status anterior", async () => {
    const db = world();
    await markTaskParada(db.asAdmin(), "step", "Falha ao gerar o relatório");
    expect(db.task("step")!.status).toBe("parada");
    expect(db.comments("step").map((c) => c.text)).toEqual(["Falha ao gerar o relatório"]);
    expect((db.task("step")!.payload as Row).keep).toBe("sim");
  });

  it("uma falha atrasada não para uma etapa que uma pessoa já concluiu", async () => {
    const db = world();
    await db.from("tasks").update({ status: "aprovado" }).eq("id", "step");
    await markTaskParada(db.asAdmin(), "step", "Falha ao gerar o relatório");
    expect(db.task("step")!.status).toBe("aprovado");
    expect(db.comments("step")).toHaveLength(0);
  });
});
