import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTaskDb, type FakeTaskDb } from "@/lib/testing/fakeTaskDb";
import { reportMissedAutomationCycles } from "./moldHealth";
import { recurringExecutionId } from "@/lib/recurrence";

// O que se prova aqui é o modo de falha que antes era invisível: o molde
// venceu, nada rodou, nenhuma exceção foi lançada. O detector tem que falar uma
// vez — e só uma — por vencimento perdido.

const notify = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./notify", () => ({ notifyFromAutomation: notify }));

const MOLD = "molde-trafego";
const TODAY = "2026-09-22";

function seed(moldOverrides: Record<string, unknown> = {}, extraTasks: Record<string, unknown>[] = []): FakeTaskDb {
  return createFakeTaskDb({
    automation_configs: [
      { id: "cfg-1", automation_key: "relatorio_trafego_semanal", target_task_id: MOLD, active: true },
    ],
    tasks: [
      {
        id: MOLD,
        title: "Relatório de tráfego — Cliente X",
        due_date: "2026-09-21",
        status: "backlog",
        recurrence_cadence: "semanal",
        payload: { recurrence_cycle: 3 },
        ...moldOverrides,
      },
      ...extraTasks,
    ],
  });
}

describe("reportMissedAutomationCycles", () => {
  beforeEach(() => notify.mockClear());

  it("comenta no molde quando o vencimento passou sem gerar a ocorrência", async () => {
    const db = seed();

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(1);

    const [comment] = db.comments(MOLD);
    expect(comment.text).toContain("não rodou");
    expect(comment.text).toContain("21/09");
    expect(comment.text).toContain("Ajuste o vencimento");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("não repete o comentário enquanto o vencimento for o mesmo", async () => {
    const db = seed();

    await reportMissedAutomationCycles(db.asAdmin(), TODAY);
    expect(await reportMissedAutomationCycles(db.asAdmin(), "2026-09-23")).toBe(0);

    expect(db.comments(MOLD)).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("aponta a Entrega em aberto quando o ciclo começou e não terminou", async () => {
    // Modo normal: a ocorrência pende do próprio molde, no ciclo dele + 1.
    const occurrenceId = recurringExecutionId(MOLD, 4);
    const db = seed({}, [
      { id: occurrenceId, title: "Entrega de Automação — 21/09", status: "em_producao", completed_at: null, workflow_version_id: "wf-1" },
    ]);

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(1);

    const [comment] = db.comments(MOLD);
    expect(comment.text).toContain("continua aberta");
    expect(comment.text).toContain("relatório de conversão");
  });

  it("modo-fluxo: procura a ocorrência no molde da ENTREGA, não no de anúncios", async () => {
    // É o caso da cascata. A `relatorio_conversao` declara depender da de
    // anúncios, e quem hospeda a ocorrência é o molde da Entrega — procurar no
    // molde de anúncios diria "não gerou nada" com a Entrega aberta na tela.
    const ENTREGA = "molde-entrega";
    const occurrenceId = recurringExecutionId(ENTREGA, 8);
    const db = seed({}, [
      { id: ENTREGA, title: "Entrega · Automação — Cliente X", due_date: "2026-09-21", status: "em_producao", recurrence_cadence: "semanal", payload: { recurrence_cycle: 7 } },
      { id: occurrenceId, title: "Entrega de Automação — 21/09", status: "revisao", completed_at: null, workflow_version_id: "wf-1" },
    ]);
    db.table("automation_configs").push({
      id: "cfg-2", automation_key: "relatorio_conversao", target_task_id: ENTREGA, active: true, depends_on_config_id: "cfg-1",
    });

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(1);

    const [comment] = db.comments(MOLD);
    expect(comment.text).toContain("continua aberta");
    // A automação de conversão não tem gate de vencimento: o molde da Entrega
    // fica vencido durante todo o ciclo e NÃO deve ser acusado.
    expect(db.comments(ENTREGA)).toHaveLength(0);
  });

  it("cala no dia do vencimento — a automação ainda vai rodar", async () => {
    const db = seed();

    expect(await reportMissedAutomationCycles(db.asAdmin(), "2026-09-21")).toBe(0);
    expect(db.comments(MOLD)).toHaveLength(0);
  });

  it("cala quando o molde avançou (vencimento no futuro)", async () => {
    const db = seed({ due_date: "2026-09-28" });

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(0);
    expect(db.comments(MOLD)).toHaveLength(0);
  });

  it("cala quando a recorrência foi encerrada de propósito", async () => {
    const db = seed({ status: "parada" });

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(0);
    expect(db.comments(MOLD)).toHaveLength(0);
  });

  it("ignora automação inativa", async () => {
    const db = seed();
    db.table("automation_configs")[0].active = false;

    expect(await reportMissedAutomationCycles(db.asAdmin(), TODAY)).toBe(0);
  });
});
