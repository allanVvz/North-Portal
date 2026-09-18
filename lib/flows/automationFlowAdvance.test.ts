import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import type { TaskRecord } from "@/lib/validation";
import { recurrenceCycleOf } from "@/lib/recurrenceState";
import { flowStepTaskId } from "./ids";

// Entrega de Automação: tráfego → feedback → conversão, uma etapa por vez.
// Cada etapa só nasce quando a anterior é concluída, e concluir duas vezes (retry,
// clique duplo, dois processos) nunca cria duas.

// O primeiro `import()` dinâmico de advance.ts custa segundos sob a suíte inteira
// (mesma razão de taskCommentRehydration.test.ts): o custo é do import, não da lógica.
vi.setConfig({ testTimeout: 30_000 });

const hooks = vi.hoisted(() => ({
  db: null as unknown as FakeTaskDb,
  prepareFeedbackCard: vi.fn(async () => null),
  processConversionFeedback: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => hooks.db }));
vi.mock("@/lib/automations/conversionFlow", () => ({
  prepareFeedbackCard: hooks.prepareFeedbackCard,
  processConversionFeedback: hooks.processConversionFeedback,
}));

import { advanceFlow, advanceFlowAfterUpdate } from "./advance";
import { advanceFlowMold } from "@/lib/automations/execute";

const OCC = "occ-1";
const MOLD = "mold-1";
const TRAFEGO = flowStepTaskId(OCC, "relatorio_anuncios");
const FEEDBACK = flowStepTaskId(OCC, "feedback");
const CONVERSAO = flowStepTaskId(OCC, "relatorio_conversao");

const stepRow = (id: string, subtype: string, status: string) => ({
  id, client_id: "cli", kind: "operacional", subtype, title: `Etapa ${subtype}`, status, priority: "media",
  assignee: "North Ai", reviewer_id: null, approver_id: null, requires_review: false, requires_approval: false,
  progress_weight: 1, client_visible: false, payload: { comments: [] }, position: 0,
});

const link = (child: string, key: string, order: number) => ({
  parent_id: OCC, child_id: child, relation_kind: "workflow_step", workflow_step_id: `ws-${key}`, slot: key, position: order,
});

function seed(steps: Array<[id: string, subtype: string, status: string, order: number]>) {
  hooks.db = createFakeTaskDb({
    tasks: [
      {
        id: MOLD, client_id: "cli", kind: "automacao", title: "Entrega Automação", status: "backlog", priority: "media",
        workflow_version_id: "wv-auto", due_date: "2026-09-21", start_date: "2026-09-21", end_date: "2026-09-21",
        recurrence_cadence: "semanal", recurrence_weekdays: [1], recurrence_day_of_month: null,
        payload: { recurrence_group: true, recurrence_cycle: 0, recurrence_revision: 0 },
      },
      {
        id: OCC, client_id: "cli", kind: "automacao", title: "Entrega Automação", status: "em_producao", priority: "media",
        workflow_version_id: "wv-auto", due_date: "2026-09-21", start_date: "2026-09-21", plan_id: MOLD,
        payload: { recurrence_parent_id: MOLD, occurrence_date: "2026-09-21", recurrence_cycle: 1 },
      },
      ...steps.map(([id, subtype, status]) => stepRow(id, subtype, status)),
    ],
    task_links: steps.map(([id, subtype, , order]) => link(id, subtype, order)),
    task_types: [{ id: "t-auto", parent_id: null, key: "automacao", label: "Automação", behavior: "entrega", active: true }],
    workflow_versions: [{ id: "wv-auto", delivery_type_id: "t-auto", version: 1, label: "Automação v1", status: "published" }],
    workflow_version_steps: [
      { id: "ws-relatorio_anuncios", workflow_version_id: "wv-auto", task_type_id: "s1", step_key: "relatorio_anuncios", label: "Relatório de anúncios", order_index: 10, progress_weight: 1, lead_days: 0, creation_trigger: "delivery_created", default_assignee: null, client_visible: false },
      { id: "ws-feedback", workflow_version_id: "wv-auto", task_type_id: "s2", step_key: "feedback", label: "Feedback", order_index: 20, progress_weight: 1, lead_days: 2, creation_trigger: "previous_step_approved", default_assignee: null, client_visible: false },
      { id: "ws-relatorio_conversao", workflow_version_id: "wv-auto", task_type_id: "s3", step_key: "relatorio_conversao", label: "Relatório de conversão", order_index: 30, progress_weight: 1, lead_days: 0, creation_trigger: "previous_step_approved", default_assignee: null, client_visible: false },
    ],
  });
}

// Retrato do momento: uma cópia, não a linha viva do banco (senão o "antes" de
// uma conclusão mudaria junto com o "depois").
const asRecord = (row: Row | undefined) => ({ ...row }) as unknown as TaskRecord;
const approve = async (id: string) => { await hooks.db.from("tasks").update({ status: "aprovado" }).eq("id", id); };
const linksTo = (stepKey: string) => hooks.db.table("task_links").filter((row) => row.parent_id === OCC && row.workflow_step_id === `ws-${stepKey}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tráfego → feedback", () => {
  beforeEach(() => seed([[TRAFEGO, "relatorio_anuncios", "revisao", 10]]));

  it("concluir o tráfego cria a etapa de feedback ligada à entrega", async () => {
    await approve(TRAFEGO);

    const outcome = await advanceFlow(hooks.db.asAdmin(), asRecord(hooks.db.task(TRAFEGO)));

    expect(outcome.created.map((task) => task.id)).toEqual([FEEDBACK]);
    expect(hooks.db.task(FEEDBACK)).toMatchObject({ subtype: "feedback", status: "backlog" });
    expect(linksTo("feedback")).toHaveLength(1);
  });

  it("a etapa seguinte NÃO nasce enquanto a anterior não foi concluída", async () => {
    // Em revisão, sem completed_at.
    const outcome = await advanceFlow(hooks.db.asAdmin(), asRecord(hooks.db.task(TRAFEGO)));

    expect(outcome.created).toEqual([]);
    expect(hooks.db.task(FEEDBACK)).toBeUndefined();
  });

  it("repetir a mesma requisição de conclusão continua com UMA tarefa de feedback", async () => {
    await approve(TRAFEGO);
    const concluded = asRecord(hooks.db.task(TRAFEGO));

    await advanceFlow(hooks.db.asAdmin(), concluded);
    await advanceFlow(hooks.db.asAdmin(), concluded);
    await advanceFlow(hooks.db.asAdmin(), concluded);

    expect(hooks.db.table("tasks").filter((row) => row.subtype === "feedback")).toHaveLength(1);
    expect(linksTo("feedback")).toHaveLength(1);
  });

  it("dois processos simultâneos concluindo o tráfego criam UMA tarefa de feedback", async () => {
    await approve(TRAFEGO);
    const concluded = asRecord(hooks.db.task(TRAFEGO));

    await Promise.all([
      advanceFlow(hooks.db.asAdmin(), concluded),
      advanceFlow(hooks.db.asAdmin(), concluded),
      advanceFlow(hooks.db.asAdmin(), concluded),
    ]);

    expect(hooks.db.table("tasks").filter((row) => row.subtype === "feedback")).toHaveLength(1);
    expect(linksTo("feedback")).toHaveLength(1);
  });

  it("execução antiga: a etapa foi concluída e logo reaberta por uma pessoa → o snapshot velho não avança o fluxo", async () => {
    await approve(TRAFEGO);
    const staleSnapshot = asRecord(hooks.db.task(TRAFEGO));
    await hooks.db.from("tasks").update({ status: "em_producao" }).eq("id", TRAFEGO);

    const outcome = await advanceFlow(hooks.db.asAdmin(), staleSnapshot);

    expect(outcome.created).toEqual([]);
    expect(hooks.db.task(FEEDBACK)).toBeUndefined();
  });

  it("advanceFlowAfterUpdate prepara o feedback ao concluir o tráfego, e só na transição", async () => {
    const before = asRecord(hooks.db.task(TRAFEGO));
    await approve(TRAFEGO);
    const after = asRecord(hooks.db.task(TRAFEGO));

    await advanceFlowAfterUpdate(before, after);
    expect(hooks.prepareFeedbackCard).toHaveBeenCalledTimes(1);
    expect(hooks.db.table("tasks").filter((row) => row.subtype === "feedback")).toHaveLength(1);

    // Salvar de novo uma etapa que já estava concluída não é um evento.
    await advanceFlowAfterUpdate(after, after);
    expect(hooks.prepareFeedbackCard).toHaveBeenCalledTimes(1);
  });
});

describe("feedback → conversão", () => {
  beforeEach(() => seed([
    [TRAFEGO, "relatorio_anuncios", "aprovado", 10],
    [FEEDBACK, "feedback", "em_producao", 20],
  ]));

  it("concluir o feedback cria UMA tarefa de conversão e dispara o processamento da conversão", async () => {
    const before = asRecord(hooks.db.task(FEEDBACK));
    await approve(FEEDBACK);

    await advanceFlowAfterUpdate(before, asRecord(hooks.db.task(FEEDBACK)));

    expect(hooks.db.table("tasks").filter((row) => row.subtype === "relatorio_conversao")).toHaveLength(1);
    expect(hooks.db.task(CONVERSAO)).toMatchObject({ status: "backlog" });
    expect(hooks.processConversionFeedback).toHaveBeenCalledWith(hooks.db, OCC);
  });

  it("conclusão repetida e dois processos simultâneos não geram conversão duplicada", async () => {
    const before = asRecord(hooks.db.task(FEEDBACK));
    await approve(FEEDBACK);
    const after = asRecord(hooks.db.task(FEEDBACK));

    await Promise.all([
      advanceFlowAfterUpdate(before, after),
      advanceFlowAfterUpdate(before, after),
    ]);
    await advanceFlowAfterUpdate(before, after);

    expect(hooks.db.table("tasks").filter((row) => row.subtype === "relatorio_conversao")).toHaveLength(1);
    expect(linksTo("relatorio_conversao")).toHaveLength(1);
  });

  it("o feedback não cria nada enquanto não estiver concluído (comentar nunca conclui)", async () => {
    const outcome = await advanceFlow(hooks.db.asAdmin(), asRecord(hooks.db.task(FEEDBACK)));
    expect(outcome.created).toEqual([]);
    expect(hooks.db.task(CONVERSAO)).toBeUndefined();
  });
});

describe("última etapa concluída → próxima Entrega recorrente", () => {
  beforeEach(() => seed([
    [TRAFEGO, "relatorio_anuncios", "aprovado", 10],
    [FEEDBACK, "feedback", "aprovado", 20],
    [CONVERSAO, "relatorio_conversao", "revisao", 30],
  ]));

  const nextOccurrences = () => hooks.db.table("tasks").filter((row) => (row.payload as Row | undefined)?.recurrence_parent_id === MOLD && row.id !== OCC);

  it("concluir a conversão avança o molde e materializa a próxima ocorrência", async () => {
    const before = asRecord(hooks.db.task(CONVERSAO));
    await approve(CONVERSAO);

    await advanceFlowAfterUpdate(before, asRecord(hooks.db.task(CONVERSAO)));

    const mold = asRecord(hooks.db.task(MOLD));
    expect(recurrenceCycleOf(mold)).toBe(1);
    expect(mold.due_date).toBe("2026-09-28");
    expect(nextOccurrences()).toHaveLength(1);
    expect(recurrenceCycleOf(asRecord(nextOccurrences()[0]))).toBe(2);
  });

  it("duas conclusões simultâneas da última etapa avançam o molde UMA vez (não pulam um ciclo)", async () => {
    const before = asRecord(hooks.db.task(CONVERSAO));
    await approve(CONVERSAO);
    const after = asRecord(hooks.db.task(CONVERSAO));

    await Promise.all([
      advanceFlowAfterUpdate(before, after),
      advanceFlowAfterUpdate(before, after),
      advanceFlowAfterUpdate(before, after),
    ]);

    const mold = asRecord(hooks.db.task(MOLD));
    expect(recurrenceCycleOf(mold)).toBe(1);
    expect(mold.due_date).toBe("2026-09-28");
    expect(nextOccurrences()).toHaveLength(1);
    // A ocorrência seguinte tem uma única primeira etapa.
    const firstSteps = hooks.db.table("task_links").filter((row) => row.parent_id === nextOccurrences()[0].id);
    expect(firstSteps).toHaveLength(1);
  });

  // O caso que o "lockstep" acima não cobre: o retry chega DEPOIS de o molde já
  // ter avançado. Sem a comparação de ciclo, o retry relia o molde no ciclo 1 e o
  // levava ao 2 — a semana de 28/09 era pulada e uma ocorrência extra nascia.
  it("retry da mesma conclusão depois de o molde já ter avançado NÃO avança de novo", async () => {
    const before = asRecord(hooks.db.task(CONVERSAO));
    await approve(CONVERSAO);
    const after = asRecord(hooks.db.task(CONVERSAO));

    await advanceFlowAfterUpdate(before, after);
    await advanceFlowAfterUpdate(before, after);

    const mold = asRecord(hooks.db.task(MOLD));
    expect(recurrenceCycleOf(mold)).toBe(1);
    expect(mold.due_date).toBe("2026-09-28");
    expect(nextOccurrences()).toHaveLength(1);
  });

  it("advanceFlowMold é compare-and-set: um leitor velho não faz o molde regredir nem reescreve o que outro caminho já avançou", async () => {
    const stale = asRecord(hooks.db.task(MOLD)); // ciclo 0, vencimento 21/09
    // Outros caminhos já avançaram o molde duas vezes.
    hooks.db.task(MOLD)!.due_date = "2026-10-05";
    hooks.db.task(MOLD)!.payload = { recurrence_group: true, recurrence_cycle: 2, recurrence_revision: 0 };

    const result = await advanceFlowMold(hooks.db.asAdmin(), stale, "2026-09-21");

    expect(recurrenceCycleOf(asRecord(hooks.db.task(MOLD)))).toBe(2);
    expect(hooks.db.task(MOLD)!.due_date).toBe("2026-10-05");
    // Quem chegou atrasado recebe o molde como ele está agora.
    expect(recurrenceCycleOf(result)).toBe(2);
  });
});
