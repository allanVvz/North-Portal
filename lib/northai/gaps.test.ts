import { describe, expect, it } from "vitest";
import { CLIENT_STANDARD_ROUTINES } from "@/lib/clientRoutines";
import type { TaskRecord } from "@/lib/validation";
import { clientInsight, findStandardRoutine } from "./gaps";

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

const base = { automations: [], hasContract: true, briefingSubmitted: false, filesReady: true, today };

describe("clientInsight", () => {
  it("aponta atrasadas, sem responsável, paradas, rotinas faltando e sem automação", () => {
    const tasks = [
      task({ id: "a", title: "Postagem", due_date: "2026-09-10" }),
      task({ id: "b", title: "Edição", assignee: null }),
      task({ id: "c", title: "Relatório", status: "parada" }),
    ];
    const insight = clientInsight({ ...base, tasks });
    const keys = insight.gaps.map((gap) => gap.key);
    expect(keys).toEqual(expect.arrayContaining(["atrasadas", "sem-responsavel", "paradas", "rotinas", "sem-automacao", "sem-plano"]));
    expect(insight.gaps.find((gap) => gap.key === "atrasadas")?.taskIds).toEqual(["a"]);
    expect(insight.gaps.find((gap) => gap.key === "rotinas")?.prefill).toMatchObject({ routineKey: CLIENT_STANDARD_ROUTINES[0].key });
    expect(insight.operation.atrasadas).toBe(1);
    expect(insight.readiness.checks.find((check) => check.key === "briefing")?.ok).toBe(false);
  });

  it("plano, moldes de rotina e automação no molde contam — não viram lacunas falsas", () => {
    const routines = CLIENT_STANDARD_ROUTINES.map((routine, index) =>
      task({ id: `r${index}`, title: routine.title, recurrence_cadence: routine.cadence, payload: routine.cadence ? { recurrence_group: true } : {} }),
    );
    const tasks = [...routines, task({ id: "p", title: "Plano 60 dias", kind: "plano_acao" })];
    const insight = clientInsight({
      ...base,
      briefingSubmitted: true,
      tasks,
      automations: [{ automationKey: "relatorio_trafego_semanal", active: true, targetTaskId: "r3" }],
    });
    const keys = insight.gaps.map((gap) => gap.key);
    expect(keys).not.toContain("rotinas");
    expect(keys).not.toContain("sem-automacao");
    expect(keys).not.toContain("sem-plano");
    expect(insight.readiness.percent).toBe(100);
    expect(insight.operation.planoAtivo).toEqual({ id: "p", title: "Plano 60 dias" });
    expect(insight.operation.rotinasAtivas).toBe(2);
  });

  it("rotina padrão reconhecida pela chave mesmo com título editado; título solto não basta", () => {
    const kickoff = CLIENT_STANDARD_ROUTINES.find((routine) => routine.key === "reuniao_kickoff")!;
    expect(findStandardRoutine([task({ id: "k", title: "Kickoff e onboarding", payload: { routine_key: "reuniao_kickoff" } })], kickoff)?.id).toBe("k");
    expect(findStandardRoutine([task({ id: "k", title: "Kickoff e onboarding" })], kickoff)).toBeNull();
    expect(findStandardRoutine([task({ id: "k", title: "Reunião de kickoff" })], kickoff)?.id).toBe("k");
  });

  it("próxima gravação é a captação aberta mais próxima a partir de hoje", () => {
    const tasks = [
      task({ id: "g1", title: "Gravação 30/09", subtype: "captacao", due_date: "2026-09-30" }),
      task({ id: "g2", title: "Gravação 22/09", subtype: "captacao", due_date: "2026-09-22" }),
      task({ id: "g0", title: "Gravação antiga", subtype: "captacao", due_date: "2026-09-01", status: "aprovado" }),
    ];
    expect(clientInsight({ ...base, tasks }).operation.proximaGravacao).toEqual({ id: "g2", title: "Gravação 22/09", date: "2026-09-22" });
  });
});
