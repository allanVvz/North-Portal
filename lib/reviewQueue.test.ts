import { describe, expect, it } from "vitest";
import { commentTargetsOf, isReportStep, reviewQueueOf } from "./reviewQueue";
import { reviewerIdsAfterManualReview } from "./flows/stepRole";
import type { TaskRecord } from "./validation";

type Link = { id: string; relation_kind: string; slot?: string | null; position?: number; status_override?: string | null };
const card = (id: string, extra: Partial<TaskRecord> & { parents?: Link[] } = {}) => ({
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

describe("destinos de comentário e fila de revisão", () => {
  it("plano: peças na ordem da lista e, dentro delas, as etapas em ordem", () => {
    expect(commentTargetsOf(plano, tasks).map((t) => t.label)).toEqual([
      "Não é Todo Mundo · Captação", "Não é Todo Mundo · Edição",
      "Paz de Espírito · Captação", "Paz de Espírito · Edição",
      "Agenda semanal",
    ]);
    expect(commentTargetsOf(plano, tasks)[1].deliveryId).toBe("peca-a");
  });

  it("a fila é só o que está em Revisão para a pessoa, em ordem", () => {
    expect(reviewQueueOf(plano, tasks, "luiza").map((t) => t.card.id)).toEqual(["edicao-a", "edicao-b", "agenda"]);
    expect(reviewQueueOf(plano, tasks, "cintia").map((t) => t.card.id)).toEqual(["edicao-a"]);
    expect(reviewQueueOf(plano, tasks, "allan")).toEqual([]);
    expect(reviewQueueOf(plano, tasks, null)).toEqual([]);
  });

  it("etapa compartilhada usa o andamento DESTA Entrega", () => {
    const compartilhada = card("edicao-c", { subtype: "edicao", status: "em_producao", reviewer_id: "luiza", parents: [step("peca-a", 30, { status_override: "revisao" }), step("peca-b", 30)] });
    const queue = reviewQueueOf(plano, [...tasks, compartilhada], "luiza");
    expect(queue.filter((t) => t.card.id === "edicao-c").map((t) => t.deliveryId)).toEqual(["peca-a"]);
  });

  it("na Entrega, as etapas; num card comum, ele mesmo", () => {
    expect(commentTargetsOf(pecaA, tasks).map((t) => t.card.id)).toEqual(["captacao", "edicao-a"]);
    expect(commentTargetsOf(tarefa, tasks)).toEqual([expect.objectContaining({ label: "Agenda semanal", deliveryId: null })]);
  });

  it("relatório: pedido interpretado; o resto volta para produção", () => {
    expect(isReportStep({ subtype: "relatorio_conversao" })).toBe(true);
    expect(isReportStep({ subtype: "edicao" })).toBe(false);
  });
});

describe("quem move para Revisão vira revisor", () => {
  it("entra na lista de revisores; quem já é revisor não muda nada", () => {
    expect(reviewerIdsAfterManualReview({ reviewer_id: "cintia", payload: { reviewer_ids: ["luiza"] } }, "allan")).toEqual(["luiza", "allan"]);
    expect(reviewerIdsAfterManualReview({ reviewer_id: "cintia", payload: {} }, "cintia")).toBeNull();
    expect(reviewerIdsAfterManualReview({ reviewer_id: null, payload: {} }, null)).toBeNull();
  });
});
