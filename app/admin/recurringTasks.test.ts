import { describe, expect, it } from "vitest";
import type { RecurringTask } from "@/lib/supabase";
import {
  recurringAssignees,
  recurringAssigneeOptions,
  recurringMatchesFilters,
  recurringMatchesQuery,
} from "./recurringTaskFilters";
import { cycleLengthDays, recurringState, todayInTimezone } from "./recurringState";
import { recurringOccurrences } from "./recurringOccurrences";
import { compareByUrgency, groupRecurring, prazoBucket } from "./recurringGrouping";
import { recurringTaskCreateSchema } from "@/lib/validation";

const task: RecurringTask = {
  id: "4f25f113-83e1-4885-8168-750b0644fae5",
  client_id: "80205169-ed27-43dc-895c-831064a356d0",
  clientName: "Cliente Exemplo",
  clientSlug: "cliente-exemplo",
  subtype: null,
  status: "backlog",
  title: "Publicação semanal",
  description: "Preparar e publicar o conteúdo",
  kind: "criativo",
  cadence: "semanal",
  weekdays: [1],
  day_of_month: null,
  next_due_date: "2026-07-27",
  time_of_day: "09:00:00",
  timezone: "America/Sao_Paulo",
  priority: "alta",
  assignee: "Ana",
  assignee_profile_ids: [],
  reviewer_id: null,
  approver_id: null,
  plan_id: null,
  parents: [],
  requires_review: false,
  requires_approval: false,
  due_date: "2026-07-27",
  start_date: "2026-07-27",
  end_date: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  progress_weight: 1,
  active: true,
  client_visible: false,
  completed_cycles: 3,
  last_completed_at: null,
  position: 0,
  payload: {},
  recurrence_cadence: "semanal",
  recurrence_weekdays: [1],
  recurrence_day_of_month: null,
  template_payload: {},
  created_at: "2026-07-20T12:00:00Z",
  updated_at: "2026-07-20T12:00:00Z",
  created_by: null,
  created_by_name: null,
  completed_at: null,
  executions: [],
};

const make = (patch: Partial<RecurringTask>): RecurringTask => ({ ...task, ...patch });

describe("tarefas recorrentes de clientes", () => {
  it("combina filtros avançados com semântica AND", () => {
    expect(recurringMatchesFilters(task, [
      { attr: "tipo", value: "criativo", label: "Criativo" },
      { attr: "prioridade", value: "alta", label: "Alta" },
      { attr: "responsavel", value: "Ana", label: "Ana" },
      { attr: "cliente", value: "Cliente Exemplo", label: "Cliente Exemplo" },
    ], "2026-07-20")).toBe(true);
    expect(recurringMatchesFilters(task, [{ attr: "frequencia", value: "mensal", label: "Mensal" }])).toBe(false);
  });

  it("encontra rotina por cliente, conteúdo e metadados, ignorando acento", () => {
    expect(recurringMatchesQuery(task, "cliente exemplo")).toBe(true);
    expect(recurringMatchesQuery(task, "publicação semanal")).toBe(true);
    expect(recurringMatchesQuery(task, "publicacao semanal")).toBe(true); // sem acento
    expect(recurringMatchesQuery(task, "ana")).toBe(true);
    expect(recurringMatchesQuery(task, "semanal alta")).toBe(true); // E: rótulo de cadência + rótulo de prioridade
    expect(recurringMatchesQuery(task, "cliente inexistente")).toBe(false);
  });

  it("permite que plano de ação seja criado como recorrência", () => {
    const result = recurringTaskCreateSchema.safeParse({ slug: "cliente-exemplo", title: "Plano", kind: "plano_acao" });
    expect(result.success).toBe(true);
  });

  it("rejeita datas, horários e fusos que falhariam apenas no banco", () => {
    const base = { slug: "cliente-exemplo", title: "Rotina" };
    expect(recurringTaskCreateSchema.safeParse({ ...base, next_due_date: "2026-02-30" }).success).toBe(false);
    expect(recurringTaskCreateSchema.safeParse({ ...base, time_of_day: "25:90" }).success).toBe(false);
    expect(recurringTaskCreateSchema.safeParse({ ...base, timezone: "America/Inexistente" }).success).toBe(false);
    expect(recurringTaskCreateSchema.safeParse({ ...base, next_due_date: "2026-02-28", time_of_day: "23:59", timezone: "America/Sao_Paulo" }).success).toBe(true);
  });
});

describe("estado da recorrência", () => {
  it("marca como parada apenas quando o prazo já passou no fuso da rotina", () => {
    expect(recurringState(make({ next_due_date: "2026-07-19" }), "2026-07-20")).toBe("parada");
    expect(recurringState(make({ next_due_date: "2026-07-20" }), "2026-07-20")).toBe("ativa");
  });

  it("não antecipa o atraso quando o servidor está em UTC e o cliente em BRT", () => {
    // 21:00 BRT no dia 20 já é 00:00 UTC do dia 21 — o cálculo ingênuo com
    // `new Date()` marcava a rotina como parada três horas antes da hora.
    const lateEvening = new Date("2026-07-21T00:30:00Z");
    expect(todayInTimezone("America/Sao_Paulo", lateEvening)).toBe("2026-07-20");
    expect(recurringState(make({ next_due_date: "2026-07-20" }), todayInTimezone("America/Sao_Paulo", lateEvening))).toBe("ativa");
  });

  it("reconhece ciclo concluído em rotina nativa, não só no card do Trello", () => {
    const nativa = make({ next_due_date: "2026-07-27", last_completed_at: "2026-07-20T13:00:00Z", weekdays: [1] });
    expect(recurringState(nativa, "2026-07-21")).toBe("concluida");

    const doTrello = make({ template_payload: { cycle_completed: true }, next_due_date: "2026-07-19" });
    expect(recurringState(doTrello, "2026-07-20")).toBe("concluida");
  });

  it("volta a ficar ativa quando a janela do ciclo vira", () => {
    const antiga = make({ next_due_date: "2026-08-24", last_completed_at: "2026-07-20T13:00:00Z" });
    expect(recurringState(antiga, "2026-08-20")).toBe("ativa");
  });

  it("trata pausada e sem data como sem agenda, pois as duas fontes divergem", () => {
    expect(recurringState(make({ active: false }), "2026-07-20")).toBe("sem_agenda");
    expect(recurringState(make({ next_due_date: null }), "2026-07-20")).toBe("sem_agenda");
  });

  it("usa o menor intervalo real entre dias da semana", () => {
    expect(cycleLengthDays({ cadence: "semanal", weekdays: [1, 4] })).toBe(3);
    expect(cycleLengthDays({ cadence: "semanal", weekdays: [1] })).toBe(7);
    expect(cycleLengthDays({ cadence: "quinzenal", weekdays: [] })).toBe(14);
  });
});

describe("expansão de ocorrências no calendário", () => {
  it("repete a rotina semanal ao longo do mês, e não uma vez só", () => {
    const dates = recurringOccurrences(make({ weekdays: [1] }), "2026-07-01", "2026-07-31");
    expect(dates).toEqual(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
  });

  it("projeta para trás do prazo âncora", () => {
    const dates = recurringOccurrences(make({ weekdays: [], next_due_date: "2026-07-27" }), "2026-07-01", "2026-07-31");
    expect(dates).toContain("2026-07-06");
    expect(dates).toContain("2026-07-27");
  });

  it("espaça a quinzenal em 14 dias", () => {
    const dates = recurringOccurrences(make({ cadence: "quinzenal", weekdays: [], next_due_date: "2026-07-15" }), "2026-07-01", "2026-07-31");
    expect(dates).toEqual(["2026-07-01", "2026-07-15", "2026-07-29"]);
  });

  it("encaixa o dia 31 em meses curtos", () => {
    const mensal = make({ cadence: "mensal", weekdays: [], day_of_month: 31, next_due_date: "2026-01-31" });
    expect(recurringOccurrences(mensal, "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
    expect(recurringOccurrences(mensal, "2026-04-01", "2026-04-30")).toEqual(["2026-04-30"]);
  });

  it("não devolve nada para rotina pausada, sem data ou intervalo invertido", () => {
    expect(recurringOccurrences(make({ active: false }), "2026-07-01", "2026-07-31")).toEqual([]);
    expect(recurringOccurrences(make({ next_due_date: null }), "2026-07-01", "2026-07-31")).toEqual([]);
    expect(recurringOccurrences(task, "2026-07-31", "2026-07-01")).toEqual([]);
  });

  it("limita a varredura para não travar em intervalos absurdos", () => {
    const dates = recurringOccurrences(make({ weekdays: [0, 1, 2, 3, 4, 5, 6] }), "2026-01-01", "2099-01-01", { maxOccurrences: 10 });
    expect(dates).toHaveLength(10);
  });
});

describe("agrupamento e ordenação do quadro", () => {
  it("separa por prazo a partir de hoje", () => {
    const hoje = "2026-07-20";
    expect(prazoBucket(make({ next_due_date: "2026-07-18" }), hoje)).toBe("paradas");
    expect(prazoBucket(make({ next_due_date: "2026-07-24" }), hoje)).toBe("semana");
    expect(prazoBucket(make({ next_due_date: "2026-08-10" }), hoje)).toBe("mes");
    expect(prazoBucket(make({ next_due_date: "2026-11-10" }), hoje)).toBe("depois");
    expect(prazoBucket(make({ next_due_date: null }), hoje)).toBe("sem_agenda");
  });

  it("não cobra como parada uma rotina cujo ciclo já foi concluído", () => {
    // A coluna tem que bater com o selo do card e com o contador do topo:
    // prazo vencido + ciclo fechado é trabalho pronto, não pendência.
    const concluida = make({ next_due_date: "2026-07-18", template_payload: { cycle_completed: true } });
    expect(prazoBucket(concluida, "2026-07-20")).toBe("concluidas");
  });

  it("ordena paradas primeiro e deixa sem data por último", () => {
    const ordenadas = [
      make({ id: "c", next_due_date: null }),
      make({ id: "b", next_due_date: "2026-08-01" }),
      make({ id: "a", next_due_date: "2026-07-01" }),
    ].sort(compareByUrgency);
    expect(ordenadas.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("desempata mesmo prazo pela atualização mais recente", () => {
    const ordenadas = [
      make({ id: "old", next_due_date: "2026-08-01", updated_at: "2026-07-18T10:00:00Z" }),
      make({ id: "new", next_due_date: "2026-08-01", updated_at: "2026-07-19T10:00:00Z" }),
    ].sort(compareByUrgency);
    expect(ordenadas.map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("omite colunas de prazo vazias", () => {
    const grupos = groupRecurring([make({ next_due_date: "2026-07-18" })], "prazo", "2026-07-20");
    expect(grupos.map((g) => g.key)).toEqual(["paradas"]);
  });

  it("coloca card compartilhado nas colunas dos dois responsáveis", () => {
    const grupos = groupRecurring([make({ assignee: "Ana, Bruno" })], "responsavel", "2026-07-20");
    expect(grupos.map((g) => g.label)).toEqual(["Ana", "Bruno"]);
  });
});

describe("responsáveis vindos do Trello", () => {
  it("separa a lista que o Trello junta numa string só", () => {
    expect(recurringAssignees({ assignee: "Ana, Bruno" })).toEqual(["Ana", "Bruno"]);
    expect(recurringAssignees({ assignee: null })).toEqual([]);
  });

  it("encontra o card compartilhado ao filtrar por uma pessoa", () => {
    const compartilhado = make({ assignee: "Ana, Bruno" });
    expect(recurringMatchesFilters(compartilhado, [{ attr: "responsavel", value: "Ana", label: "Ana" }])).toBe(true);
    expect(recurringMatchesFilters(compartilhado, [{ attr: "responsavel", value: "Carla", label: "Carla" }])).toBe(false);
  });

  it("oferece cada pessoa uma vez e só mostra Sem responsável quando existe", () => {
    expect(recurringAssigneeOptions([{ assignee: "Ana, Bruno" }, { assignee: "Ana" }])).toEqual(["Ana", "Bruno"]);
    expect(recurringAssigneeOptions([{ assignee: "Ana" }, { assignee: null }])).toEqual(["Ana", "Sem responsável"]);
  });

  it("filtra corretamente as rotinas sem responsável", () => {
    expect(recurringMatchesFilters(make({ assignee: null }), [{ attr: "responsavel", value: "Sem responsável", label: "Sem responsável" }])).toBe(true);
    expect(recurringMatchesFilters(task, [{ attr: "responsavel", value: "Sem responsável", label: "Sem responsável" }])).toBe(false);
  });
});
