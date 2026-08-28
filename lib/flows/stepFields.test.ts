import { describe, expect, it } from "vitest";
import { flowStepFields } from "./stepFields";
import { flowStepTaskId } from "./ids";
import type { FlowStepDef } from "./template";
import type { TaskRecord } from "@/lib/validation";

const step: FlowStepDef = {
  id: "s2", step_key: "captacao", order_index: 20, title: "Captação",
  kind: "criativo", subtype: "captacao", lead_days: 3, progress_weight: 1,
  default_assignee: null, client_visible: false,
};

const delivery = {
  id: "entrega-1", client_id: "cli", kind: "criativo", subtype: null,
  title: "Vídeo institucional", status: "backlog", priority: "media",
  assignee: "Ana", assignee_profile_ids: [], reviewer_id: "rev", approver_id: "apr",
  plan_id: null, flow_template_id: "tpl", requires_review: true, requires_approval: true,
  due_date: null, start_date: null, end_date: null, scheduled_start_at: null, scheduled_end_at: null,
  progress_weight: 1, description: null, client_visible: false,
  payload: { action_plan_id: "plano-9" }, position: 0,
  recurrence_cadence: null, recurrence_weekdays: [], recurrence_day_of_month: null,
  created_by: null, created_by_name: null, created_at: "", completed_at: null, updated_at: "",
} as TaskRecord;

const previous = { ...delivery, id: "roteiro-1", assignee: "Bruno", payload: { flow_step_key: "roteiro" } } as TaskRecord;

describe("flowStepFields", () => {
  it("dá à etapa o id determinístico da dupla (entrega, step_key)", () => {
    const fields = flowStepFields(delivery, step, previous, "2026-08-28");
    expect(fields.id).toBe(flowStepTaskId("entrega-1", "captacao"));
    // Estabilidade é o ponto: outro dia, outra etapa anterior, mesmo id.
    expect(flowStepFields(delivery, step, null, "2026-09-30").id).toBe(fields.id);
  });

  it("pendura a etapa na entrega e nunca lhe dá um fluxo próprio", () => {
    const fields = flowStepFields(delivery, step, previous, "2026-08-28");
    expect(fields.plan_id).toBe("entrega-1");
    expect(fields.flow_template_id).toBeNull();
    expect(fields.recurrence_cadence).toBeNull();
  });

  it("agenda a partir de hoje + lead_days do molde", () => {
    expect(flowStepFields(delivery, step, previous, "2026-08-28").due_date).toBe("2026-08-31");
    expect(flowStepFields(delivery, { ...step, lead_days: 0 }, previous, "2026-08-28").due_date).toBe("2026-08-28");
  });

  it("carrega o vínculo com o Plano de Ação da entrega e o link para a etapa anterior", () => {
    const payload = flowStepFields(delivery, step, previous, "2026-08-28").payload as Record<string, unknown>;
    expect(payload).toEqual({ flow_step_key: "captacao", flow_prev_task_id: "roteiro-1", action_plan_id: "plano-9" });
  });

  it("não herda status, descrição nem histórico da etapa anterior", () => {
    const fields = flowStepFields(delivery, step, { ...previous, status: "aprovado", description: "roteiro pronto" }, "2026-08-28");
    expect(fields.status).toBe("backlog");
    expect(fields.description).toBeNull();
  });

  it("prefere o responsável do molde, cai no da etapa anterior e só então no rótulo da automação", () => {
    expect(flowStepFields(delivery, { ...step, default_assignee: "Editor" }, previous, "2026-08-28").assignee).toBe("Editor");
    expect(flowStepFields(delivery, step, previous, "2026-08-28").assignee).toBe("Bruno");
    expect(flowStepFields(delivery, step, null, "2026-08-28").assignee).toBe("North ai");
  });

  it("usa a visibilidade declarada no molde, não a da entrega", () => {
    expect(flowStepFields(delivery, { ...step, client_visible: true }, previous, "2026-08-28").client_visible).toBe(true);
    expect(flowStepFields(delivery, step, previous, "2026-08-28").client_visible).toBe(false);
  });
});
