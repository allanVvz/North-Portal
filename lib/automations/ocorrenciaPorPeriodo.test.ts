import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb, type Row } from "@/lib/testing/fakeTaskDb";
import { recurringExecutionId } from "@/lib/recurrence";
import type { TaskRecord } from "@/lib/validation";

// O cenário de 21/09/2026, que a identidade por contador tornava impossível de
// sair: a Entrega da semana anterior segue aberta e o molde não avançou. Antes, a
// semana seguinte reusava a MESMA ocorrência (id derivado do ciclo do molde, que
// só avança na conclusão) e a etapa em `revisao` recusava o compare-and-set — a
// automação morria em silêncio. Com a identidade sendo o DIA, 28/09 é outra chave.

vi.mock("@/lib/workflows", () => ({
  publishedWorkflowForKind: vi.fn(async () => ({
    id: "wv-1", delivery_type_id: "dt-1", version: 1, label: "Automação",
    steps: [{ key: "relatorio_anuncios", label: "Relatório de anúncios", order_index: 0, workflow_step_id: "ws-ads", task_type_id: "tt-ads", lead_days: 0, progress_weight: 1, default_assignee: null, client_visible: true, creation_trigger: "delivery_created" }],
  })),
}));

import { advanceFlowMold, ensureFlowOccurrence } from "./execute";

const MOLD = "molde-entrega";
const asRecord = (row: Row | undefined) => row as unknown as TaskRecord;

function seed(over: Partial<Row> = {}): FakeTaskDb {
  return createFakeTaskDb({
    tasks: [{
      id: MOLD, client_id: "cli", kind: "automacao", title: "Relatórios · Automação",
      status: "backlog", due_date: "2026-09-21", start_date: "2026-09-21", end_date: "2026-09-21",
      recurrence_cadence: "semanal", recurrence_weekdays: [1], workflow_version_id: "wv-1",
      payload: { recurrence_group: true, recurrence_cycle: 0 }, ...over,
    }],
  });
}

describe("identidade da ocorrência pelo período", () => {
  it("o id vem da DATA, não do ciclo do molde", async () => {
    const db = seed();
    const occ = await ensureFlowOccurrence(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-28");
    expect(occ.id).toBe(recurringExecutionId(MOLD, "2026-09-28"));
    expect(occ.id).not.toBe(recurringExecutionId(MOLD, 1));
  });

  it("duas semanas = duas ocorrências, mesmo com o molde parado no ciclo 0", async () => {
    const db = seed();
    const mold = asRecord(db.task(MOLD));
    const semana1 = await ensureFlowOccurrence(db.asAdmin(), mold, "2026-09-21");
    const semana2 = await ensureFlowOccurrence(db.asAdmin(), mold, "2026-09-28");

    expect(semana1.id).not.toBe(semana2.id);
    expect(db.table("tasks").filter((t) => t.payload && (t.payload as Row).recurrence_parent_id === MOLD)).toHaveLength(2);
    // É este o ponto: o ciclo do molde nunca se moveu, e a semana 2 nasceu.
    expect((db.task(MOLD)!.payload as Row).recurrence_cycle).toBe(0);
  });

  it("o mesmo dia duas vezes é idempotente", async () => {
    const db = seed();
    const mold = asRecord(db.task(MOLD));
    const a = await ensureFlowOccurrence(db.asAdmin(), mold, "2026-09-28");
    const b = await ensureFlowOccurrence(db.asAdmin(), mold, "2026-09-28");
    expect(a.id).toBe(b.id);
    expect(db.table("tasks").filter((t) => t.payload && (t.payload as Row).recurrence_parent_id === MOLD)).toHaveLength(1);
  });

  it("TRANSIÇÃO: reencontra a ocorrência legada (id por ciclo) enquanto ela está aberta", async () => {
    // Sem isto, o primeiro tique depois do deploy criaria uma SEGUNDA Entrega
    // para a semana que já estava em andamento.
    const db = seed();
    const legadoId = recurringExecutionId(MOLD, 1);
    db.table("tasks").push({
      id: legadoId, client_id: "cli", kind: "automacao", title: "Relatórios · Automação",
      status: "revisao", completed_at: null, workflow_version_id: "wv-1", due_date: "2026-09-21",
      payload: { recurrence_parent_id: MOLD, recurrence_cycle: 1 },
    });

    const occ = await ensureFlowOccurrence(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-21");
    expect(occ.id).toBe(legadoId);
  });

  it("legada já CONCLUÍDA não é reusada — o ciclo novo nasce com id de data", async () => {
    const db = seed();
    db.table("tasks").push({
      id: recurringExecutionId(MOLD, 1), client_id: "cli", kind: "automacao", title: "Relatórios · Automação",
      status: "aprovado", completed_at: "2026-09-25T10:00:00Z", workflow_version_id: "wv-1",
      payload: { recurrence_parent_id: MOLD, recurrence_cycle: 1 },
    });

    const occ = await ensureFlowOccurrence(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-28");
    expect(occ.id).toBe(recurringExecutionId(MOLD, "2026-09-28"));
  });
});

describe("advanceFlowMold — absoluto e monotônico", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula a partir da OCORRÊNCIA processada, nunca do vencimento antigo", async () => {
    // O bug que isto mata: molde parado em 18/09 (sexta) avançava para 21/09 pela
    // regra de segunda — uma data já passada, que o gate estrito nunca casava.
    const db = seed({ due_date: "2026-09-18", start_date: "2026-09-18" });
    const mold = await advanceFlowMold(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-28");
    expect(mold.due_date).toBe("2026-10-05");
  });

  it("a mesma ocorrência duas vezes não move nada — nem a data nem o contador", async () => {
    const db = seed();
    await advanceFlowMold(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-21");
    const depoisDaPrimeira = { ...db.task(MOLD)! };
    await advanceFlowMold(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-21");

    expect(db.task(MOLD)!.due_date).toBe(depoisDaPrimeira.due_date);
    expect((db.task(MOLD)!.payload as Row).recurrence_cycle).toBe((depoisDaPrimeira.payload as Row).recurrence_cycle);
  });

  it("nunca retrocede: uma ocorrência antiga processada depois não puxa o vencimento para trás", async () => {
    const db = seed();
    await advanceFlowMold(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-28"); // → 05/10
    await advanceFlowMold(db.asAdmin(), asRecord(db.task(MOLD)), "2026-09-14"); // → 21/09, no passado
    expect(db.task(MOLD)!.due_date).toBe("2026-10-05");
  });
});
