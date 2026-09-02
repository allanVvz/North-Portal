import { describe, expect, it } from "vitest";
import { normalizeSearchText, taskMatchesQuery, taskSearchText } from "./taskSearch";
import { formatShortDate } from "@/app/admin/taskDates";
import type { TaskRecord } from "./validation";

const base: TaskRecord = {
  id: "task-1",
  client_id: "cli",
  kind: "criativo",
  subtype: null,
  title: "Relatório mensal",
  status: "em_producao",
  priority: "alta",
  assignee: "Ana Souza",
  assignee_profile_ids: [],
  reviewer_id: null,
  approver_id: null,
  plan_id: null,
  parents: [],
  requires_review: false,
  requires_approval: false,
  due_date: "2026-09-15",
  start_date: null,
  end_date: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  progress_weight: 1,
  description: "resumo de métricas",
  client_visible: false,
  payload: {
    formato: "Carrossel",
    plataforma: "Instagram",
    comments: [
      { author: "Carla", text: "ajustar a chamada", at: "2026-09-01T10:00:00Z" },
      { author: "Dario", text: "aprovado pelo cliente", at: "2026-09-02T10:00:00Z" },
    ],
  },
  position: 0,
  recurrence_cadence: null,
  recurrence_weekdays: [],
  recurrence_day_of_month: null,
  created_by: null,
  created_by_name: "Bruno Lima",
  created_at: "",
  completed_at: null,
  updated_at: "",
};

function make(patch: Partial<TaskRecord>): TaskRecord {
  return { ...base, ...patch };
}

describe("taskMatchesQuery", () => {
  it("exige todos os termos (E)", () => {
    expect(taskMatchesQuery(base, "relatorio ana")).toBe(true);
    expect(taskMatchesQuery(base, "relatorio zebra")).toBe(false);
  });

  it("ignora acento nos dois lados", () => {
    expect(taskMatchesQuery(base, "relatório")).toBe(true);
    expect(taskMatchesQuery(base, "relatorio")).toBe(true);
    expect(taskMatchesQuery(base, "metricas")).toBe(true); // haystack tem "métricas"
  });

  it("entra no corpo do comentário", () => {
    expect(taskMatchesQuery(base, "chamada")).toBe(true);
  });

  it("entra no autor do comentário", () => {
    expect(taskMatchesQuery(base, "carla")).toBe(true);
  });

  it("acha por campo de payload", () => {
    expect(taskMatchesQuery(base, "carrossel instagram")).toBe(true);
  });

  it("acha por rótulo de tipo, prioridade e status", () => {
    expect(taskMatchesQuery(base, "entrega")).toBe(true); // kindLabel(criativo) === "Entrega"
    expect(taskMatchesQuery(base, "alta")).toBe(true);
    expect(taskMatchesQuery(base, "produção")).toBe(true); // STATUS_LABEL[em_producao]
  });

  it("acha por autor do card", () => {
    expect(taskMatchesQuery(base, "bruno")).toBe(true);
  });

  it("acha por data crua e formatada", () => {
    expect(taskMatchesQuery(base, "2026-09-15")).toBe(true);
    expect(taskMatchesQuery(base, formatShortDate("2026-09-15"))).toBe(true); // "15 de set." / "15 set."
  });

  it("usa o contexto (nome do cliente)", () => {
    expect(taskMatchesQuery(base, "acme", { clientName: "ACME Ltda" })).toBe(true);
    expect(taskMatchesQuery(base, "acme")).toBe(false);
  });

  it("query vazia casa com tudo", () => {
    expect(taskMatchesQuery(base, "   ")).toBe(true);
  });

  it("não casa termo ausente", () => {
    expect(taskMatchesQuery(base, "linkedin")).toBe(false);
  });

  it("subtipo entra no haystack", () => {
    const roteiro = make({ subtype: "roteiro" });
    expect(taskMatchesQuery(roteiro, "roteiro")).toBe(true);
  });

  it("não deixa 'sem data' casar com card sem prazo", () => {
    const semData = make({ due_date: null });
    expect(taskMatchesQuery(semData, "sem data")).toBe(false);
  });
});

describe("taskSearchText memoização", () => {
  it("é estável e não reflete mutação posterior do objeto", () => {
    const task = make({ title: "Original" });
    const first = taskSearchText(task);
    expect(taskSearchText(task)).toBe(first);
    task.title = "Alterado depois";
    expect(taskSearchText(task)).toBe(first); // cacheado pela referência do objeto
  });

  it("o contexto fica fora do cache", () => {
    const task = make({});
    expect(taskSearchText(task, { clientName: "ACME" })).toContain("acme");
    expect(taskSearchText(task, { clientName: "Outro" })).toContain("outro");
  });
});

describe("normalizeSearchText", () => {
  it("remove acento e baixa a caixa", () => {
    expect(normalizeSearchText("Ação É")).toBe("acao e");
  });
});
