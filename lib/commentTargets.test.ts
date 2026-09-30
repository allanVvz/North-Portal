import { describe, expect, it } from "vitest";
import { canDecide, commentRequestOf, commentTargetsOf, reviewDecisionRequestOf, reviewQueueOf } from "./commentTargets";
import type { TaskRecord } from "./validation";

type Link = { id: string; relation_kind: string; slot?: string | null; position?: number; status_override?: string | null };
const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, kind: "operacional", subtype: null, status: "backlog", reviewer_id: null, payload: {}, parents: [],
  workflow_version_id: null, recurrence_cadence: null, completed_at: null, ...extra,
}) as unknown as TaskRecord;
const member = (planId: string, position: number): Link => ({ id: planId, relation_kind: "structural_member", slot: null, position });
const step = (deliveryId: string, position: number, extra: Partial<Link> = {}): Link => ({ id: deliveryId, relation_kind: "workflow_step", slot: `s${position}`, position, ...extra });

// Plano da Baita: duas peças com Edição própria e uma Captação compartilhada.
const plano = card("plano", { kind: "plano_acao", title: "PLANO DE CONTEÚDO" });
const pecaA = card("peca-a", { kind: "criativo", title: "Não é Todo Mundo", workflow_version_id: "wv", parents: [member("plano", 1)] });
const pecaB = card("peca-b", { kind: "criativo", title: "Paz de Espírito", workflow_version_id: "wv", parents: [member("plano", 2)] });
const captacao = card("captacao", { subtype: "captacao", status: "aprovado", parents: [step("peca-a", 10), step("peca-b", 10)] });
const edicaoA = card("edicao-a", { subtype: "edicao", status: "revisao", reviewer_id: "cintia", payload: { reviewer_ids: ["luiza"] }, parents: [step("peca-a", 20)] });
const edicaoB = card("edicao-b", { subtype: "edicao", status: "revisao", reviewer_id: "luiza", parents: [step("peca-b", 20)] });
const tarefa = card("agenda", { title: "Agenda semanal", status: "revisao", reviewer_id: "luiza", parents: [member("plano", 3)] });
const tasks = [plano, pecaA, pecaB, captacao, edicaoA, edicaoB, tarefa];

describe("destinos de comentário", () => {
  it("plano: nota do plano, depois as peças na ordem da lista e, dentro delas, as etapas", () => {
    expect(commentTargetsOf(plano, tasks).map((t) => t.label)).toEqual([
      "Nota do plano",
      "Não é Todo Mundo · Captação", "Não é Todo Mundo · Edição",
      "Paz de Espírito · Captação", "Paz de Espírito · Edição",
      "Agenda semanal",
    ]);
  });

  it("etapa concluída só é destino quando o servidor aceita: nenhuma ou várias abertas", () => {
    const roteiro = card("roteiro", { subtype: "roteiro", status: "aprovado", completed_at: "2026-09-14", parents: [step("peca-a", 5)] });
    const captacaoConcluida = { ...captacao, completed_at: "2026-09-16" } as TaskRecord;
    const umaAberta = [...tasks.filter((t) => t.id !== "captacao"), captacaoConcluida, roteiro];
    expect(commentTargetsOf(pecaA, umaAberta).map((t) => t.card.id)).toEqual(["edicao-a"]);
    // Captação sem `completed_at` ainda está aberta: duas abertas, todas valem.
    expect(commentTargetsOf(pecaA, [...tasks, roteiro]).map((t) => t.card.id)).toEqual(["roteiro", "captacao", "edicao-a"]);
  });

  it("a etapa compartilhada aparece uma vez por Entrega, com chave própria", () => {
    const keys = commentTargetsOf(plano, tasks).filter((t) => t.card.id === "captacao").map((t) => t.key);
    expect(keys).toEqual(["captacao@peca-a", "captacao@peca-b"]);
  });

  it("na Entrega, as etapas pelo nome; num card comum, ele mesmo", () => {
    expect(commentTargetsOf(pecaA, tasks).map((t) => t.label)).toEqual(["Captação", "Edição"]);
    expect(commentTargetsOf(tarefa, tasks)).toEqual([expect.objectContaining({ label: "Agenda semanal", deliveryId: null })]);
  });

  it("Entrega ainda sem etapas: o comentário fica nela", () => {
    const nova = card("nova", { kind: "criativo", workflow_version_id: "wv" });
    expect(commentTargetsOf(nova, [nova]).map((t) => t.post)).toEqual([{ taskId: "nova" }]);
  });

  it("etapa aberta direto usa o andamento da Entrega de contexto", () => {
    const compartilhada = card("edicao-c", { subtype: "edicao", status: "em_producao", reviewer_id: "luiza", parents: [step("peca-a", 30, { status_override: "revisao" })] });
    const [target] = commentTargetsOf(compartilhada, [compartilhada], { contextDeliveryId: "peca-a" });
    expect(target.card.status).toBe("revisao");
    expect(target.deliveryId).toBe("peca-a");
    expect(target.post).toEqual({ taskId: "edicao-c" });
  });
});

describe("fila de revisão", () => {
  const targets = commentTargetsOf(plano, tasks);

  it("é só o que está em Revisão para a pessoa, em ordem", () => {
    expect(reviewQueueOf(targets, "luiza").map((t) => t.card.id)).toEqual(["edicao-a", "edicao-b", "agenda"]);
    expect(reviewQueueOf(targets, "cintia").map((t) => t.card.id)).toEqual(["edicao-a"]);
    expect(reviewQueueOf(targets, "allan")).toEqual([]);
    expect(reviewQueueOf(targets, null)).toEqual([]);
  });

  it("etapa compartilhada entra só na Entrega em que está em Revisão", () => {
    const compartilhada = card("edicao-c", { subtype: "edicao", status: "em_producao", reviewer_id: "luiza", parents: [step("peca-a", 30, { status_override: "revisao" }), step("peca-b", 30)] });
    const queue = reviewQueueOf(commentTargetsOf(plano, [...tasks, compartilhada]), "luiza");
    expect(queue.filter((t) => t.card.id === "edicao-c").map((t) => t.deliveryId)).toEqual(["peca-a"]);
  });

  it("nota do plano nunca é decidida, mesmo com o plano em Revisão", () => {
    const planoEmRevisao = card("plano", { kind: "plano_acao", status: "revisao", reviewer_id: "luiza" });
    expect(canDecide(commentTargetsOf(planoEmRevisao, [planoEmRevisao])[0], "luiza")).toBe(false);
  });
});

describe("endpoints", () => {
  const targets = commentTargetsOf(plano, tasks);
  const edicao = targets.find((t) => t.key === "edicao-a@peca-a")!;

  it("etapa pelo plano vai pela Entrega, para ganhar a marca dela", () => {
    expect(commentRequestOf(edicao, { text: "ok", commentId: "c1" })).toEqual({
      url: "/api/admin/tasks/peca-a/comments",
      body: { text: "ok", comment_id: "c1", stage_task_id: "edicao-a" },
    });
  });

  it("nota do plano vai no plano; card comum, nele mesmo; anexos seguem junto", () => {
    expect(commentRequestOf(targets[0], { text: "ata", commentId: "c2" })).toEqual({ url: "/api/admin/tasks/plano/comments", body: { text: "ata", comment_id: "c2", plan_note: true } });
    const agenda = targets.find((t) => t.card.id === "agenda")!;
    expect(commentRequestOf(agenda, { text: "x", commentId: "c3", assetIds: ["a1"] }).body).toEqual({ text: "x", comment_id: "c3", asset_ids: ["a1"] });
  });

  it("decisão vai no card decidido, com a Entrega quando há", () => {
    expect(reviewDecisionRequestOf(edicao, "approve", "r1")).toEqual({
      url: "/api/admin/tasks/edicao-a/review-decision",
      body: { decision: "approve", expected_status: "revisao", delivery_id: "peca-a", request_id: "r1" },
    });
    const agenda = targets.find((t) => t.card.id === "agenda")!;
    expect(reviewDecisionRequestOf(agenda, "request_changes", "r2").body).toEqual({ decision: "request_changes", expected_status: "revisao", request_id: "r2" });
  });
});
