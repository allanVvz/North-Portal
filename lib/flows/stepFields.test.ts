import { describe, expect, it } from "vitest";
import { flowStepFields } from "./stepFields";
import { flowStepTaskId } from "./ids";
import type { TaskSubtypeDef } from "@/lib/taskTypes";
import type { TaskRecord } from "@/lib/validation";

const step: TaskSubtypeDef = {
  key: "captacao", label: "Captação", order_index: 20,
  lead_days: 3, progress_weight: 1, default_assignee: null, client_visible: false,
};

const delivery = {
  id: "entrega-1", client_id: "cli", kind: "criativo", subtype: null,
  title: "Vídeo institucional", status: "em_producao", priority: "media",
  assignee: "Ana", assignee_profile_ids: [], reviewer_id: "rev", approver_id: "apr",
  plan_id: null, parents: [], requires_review: true, requires_approval: true,
  due_date: null, start_date: null, end_date: null, scheduled_start_at: null, scheduled_end_at: null,
  progress_weight: 1, description: null, client_visible: false,
  payload: { flow_parent: true }, position: 0,
  recurrence_cadence: null, recurrence_weekdays: [], recurrence_day_of_month: null,
  created_by: null, created_by_name: null, created_at: "", completed_at: null, updated_at: "",
} as TaskRecord;

const previous = { ...delivery, id: "roteiro-1", subtype: "roteiro", assignee: "Bruno", payload: {} } as TaskRecord;

describe("flowStepFields", () => {
  it("dá à etapa o id determinístico da dupla (entrega, subtipo)", () => {
    const fields = flowStepFields(delivery, step, previous, "2026-08-28");
    expect(fields.id).toBe(flowStepTaskId("entrega-1", "captacao"));
    // Estabilidade é o ponto: outro dia, outra etapa anterior, mesmo id.
    expect(flowStepFields(delivery, step, null, "2026-09-30").id).toBe(fields.id);
  });

  // A etapa é do mesmo TIPO da entrega — é o subtipo que diz qual etapa ela é.
  it("herda o tipo da entrega e recebe o subtipo da etapa", () => {
    const fields = flowStepFields(delivery, step, previous, "2026-08-28");
    expect(fields.kind).toBe("criativo");
    expect(fields.subtype).toBe("captacao");
  });

  // O vínculo com a entrega é um ELO, escrito à parte: um mesmo card pode
  // pertencer a várias entregas, e plan_id só guarda recorrência.
  it("não usa plan_id nem carrega recorrência", () => {
    const fields = flowStepFields(delivery, step, previous, "2026-08-28");
    expect(fields.plan_id).toBeNull();
    expect(fields.recurrence_cadence).toBeNull();
  });

  it("agenda a partir de hoje + lead_days do subtipo", () => {
    expect(flowStepFields(delivery, step, previous, "2026-08-28").due_date).toBe("2026-08-31");
    expect(flowStepFields(delivery, { ...step, lead_days: 0 }, previous, "2026-08-28").due_date).toBe("2026-08-28");
  });

  it("guarda o link para a etapa anterior", () => {
    const payload = flowStepFields(delivery, step, previous, "2026-08-28").payload as Record<string, unknown>;
    expect(payload).toEqual({ flow_prev_task_id: "roteiro-1" });
  });

  it("não herda status, descrição nem histórico da etapa anterior", () => {
    const fields = flowStepFields(delivery, step, { ...previous, status: "aprovado", description: "roteiro pronto" }, "2026-08-28");
    expect(fields.status).toBe("backlog");
    expect(fields.description).toBeNull();
  });

  it("prefere o responsável do subtipo, cai no da etapa anterior e só então no rótulo da automação", () => {
    expect(flowStepFields(delivery, { ...step, default_assignee: "Editor" }, previous, "2026-08-28").assignee).toBe("Editor");
    expect(flowStepFields(delivery, step, previous, "2026-08-28").assignee).toBe("Bruno");
    expect(flowStepFields(delivery, step, null, "2026-08-28").assignee).toBe("North ai");
  });

  it("usa a visibilidade declarada no subtipo, não a da entrega", () => {
    expect(flowStepFields(delivery, { ...step, client_visible: true }, previous, "2026-08-28").client_visible).toBe(true);
    expect(flowStepFields(delivery, step, previous, "2026-08-28").client_visible).toBe(false);
  });
});
