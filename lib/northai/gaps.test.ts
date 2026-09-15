import { describe, expect, it } from "vitest";
import { CLIENT_STANDARD_ROUTINES } from "@/lib/clientRoutines";
import type { TaskRecord } from "@/lib/validation";
import { clientInsight } from "./gaps";

const today = "2026-09-15";

function task(partial: Partial<TaskRecord> & { id: string; title: string }): TaskRecord {
  return {
    kind: "operacional",
    subtype: null,
    status: "backlog",
    assignee: "Allan",
    assignee_profile_ids: [],
    due_date: "2026-09-20",
    recurrence_cadence: null,
    payload: {},
    parents: [],
    ...partial,
  } as unknown as TaskRecord;
}

describe("clientInsight", () => {
  it("aponta atrasadas, sem responsável, rotinas faltando e sem automação", () => {
    const tasks = [
      task({ id: "a", title: "Postagem", due_date: "2026-09-10" }),
      task({ id: "b", title: "Edição", assignee: null }),
      task({ id: "c", title: "Relatório", status: "parada" }),
    ];
    const insight = clientInsight({ tasks, automations: [], hasContract: true, briefingSubmitted: false, gedReady: true, today });
    const keys = insight.gaps.map((gap) => gap.key);
    expect(keys).toEqual(expect.arrayContaining(["atrasadas", "sem-responsavel", "paradas", "rotinas", "sem-automacao", "sem-plano"]));
    expect(insight.gaps.find((gap) => gap.key === "atrasadas")?.taskIds).toEqual(["a"]);
    expect(insight.gaps.find((gap) => gap.key === "rotinas")?.recipe).toBe("rotina");
    expect(insight.numbers.atrasadas).toBe(1);
    expect(insight.readiness.checks.find((check) => check.key === "briefing")?.ok).toBe(false);
  });

  it("cliente amarrado não tem lacunas de rotina/automação e fica em 100%", () => {
    const routines = CLIENT_STANDARD_ROUTINES.map((routine, index) => task({ id: `r${index}`, title: routine.title }));
    const tasks = [...routines, task({ id: "p", title: "Plano 60 dias", kind: "plano_acao" })];
    const insight = clientInsight({
      tasks,
      automations: [{ automationKey: "relatorio_trafego_semanal", active: true, targetTaskId: "r0" }],
      hasContract: true,
      briefingSubmitted: true,
      gedReady: true,
      today,
    });
    expect(insight.gaps.map((gap) => gap.key)).not.toContain("rotinas");
    expect(insight.gaps.map((gap) => gap.key)).not.toContain("sem-automacao");
    expect(insight.readiness.percent).toBe(100);
  });
});
