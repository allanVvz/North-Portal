// O molde de um fluxo em cascata. Vive no banco (task_flow_templates /
// task_flow_steps) porque a operação precisa montar fluxos novos sem deploy —
// mesmo papel e mesma forma de commercial_checkpoint_templates, que também é
// "molde no banco, trabalho em tasks".
//
// Nada aqui cria card nenhum: este módulo só lê e valida o molde. Quem
// materializa é advance.ts.

import type { AdminClient } from "@/lib/automations/taskAccess";
import type { FlowStepDef, FlowTemplate } from "./types";

export type { FlowStepDef, FlowTemplate };

/** Só a capacidade de ler tabelas. O molde é lido tanto pelo client de serviço
 * (motor da cascata, sem sessão) quanto pelo client da requisição (telas de
 * admin, onde a RLS é a guarda real) — tipar pela capacidade evita forçar o
 * client de serviço em caminhos que têm sessão. */
export type FlowReader = Pick<AdminClient, "from">;


export const FLOW_TEMPLATE_COLUMNS = "id,name,description,active";
export const FLOW_STEP_COLUMNS =
  "id,step_key,order_index,title,kind,subtype,lead_days,progress_weight,default_assignee,client_visible";

/** Sorted by order_index — the sequence IS the feature, so no caller should
 * ever have to remember to sort. order_index has no unique index (reordering
 * would need a swap dance), so ties fall back to step_key for a stable order. */
function sortedSteps(rows: FlowStepDef[]): FlowStepDef[] {
  return [...rows].sort((a, b) => a.order_index - b.order_index || a.step_key.localeCompare(b.step_key));
}

export async function getFlowTemplate(admin: FlowReader, templateId: string): Promise<FlowTemplate | null> {
  const { data, error } = await admin
    .from("task_flow_templates")
    .select(FLOW_TEMPLATE_COLUMNS)
    .eq("id", templateId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as Omit<FlowTemplate, "steps"> | undefined;
  if (!row) return null;

  const { data: stepRows, error: stepsError } = await admin
    .from("task_flow_steps")
    .select(FLOW_STEP_COLUMNS)
    .eq("template_id", templateId);
  if (stepsError) throw stepsError;
  return { ...row, steps: sortedSteps((stepRows ?? []) as FlowStepDef[]) };
}

export async function listFlowTemplates(admin: FlowReader, onlyActive = false): Promise<FlowTemplate[]> {
  let query = admin.from("task_flow_templates").select(FLOW_TEMPLATE_COLUMNS).order("name");
  if (onlyActive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  const templates = (data ?? []) as Omit<FlowTemplate, "steps">[];
  if (templates.length === 0) return [];

  const { data: stepRows, error: stepsError } = await admin
    .from("task_flow_steps")
    .select(`template_id,${FLOW_STEP_COLUMNS}`)
    .in("template_id", templates.map((t) => t.id));
  if (stepsError) throw stepsError;

  const byTemplate = new Map<string, FlowStepDef[]>();
  for (const row of (stepRows ?? []) as (FlowStepDef & { template_id: string })[]) {
    const bucket = byTemplate.get(row.template_id) ?? [];
    bucket.push(row);
    byTemplate.set(row.template_id, bucket);
  }
  return templates.map((t) => ({ ...t, steps: sortedSteps(byTemplate.get(t.id) ?? []) }));
}

/** Total weight of the whole mold — the denominator a delivery freezes into
 * payload at creation. Steps not materialized yet still count against it,
 * which is the whole reason the snapshot exists (see FLOW_TOTAL_WEIGHT_KEY). */
export function templateTotalWeight(template: FlowTemplate): number {
  return template.steps.reduce((sum, step) => sum + (Number(step.progress_weight) || 1), 0);
}

export function stepAt(template: FlowTemplate, index: number): FlowStepDef | null {
  return template.steps[index] ?? null;
}

export function stepIndexOf(template: FlowTemplate, stepKey: string | null): number {
  if (!stepKey) return -1;
  return template.steps.findIndex((step) => step.step_key === stepKey);
}

export function nextStepAfter(template: FlowTemplate, stepKey: string | null): FlowStepDef | null {
  const index = stepIndexOf(template, stepKey);
  if (index < 0) return null;
  return stepAt(template, index + 1);
}

/** A mold that would produce a broken cascade. Checked when a template is
 * saved and again before instantiating one, because a template edited between
 * those two moments is exactly the case a save-time check can't cover. */
export function flowTemplateProblem(template: FlowTemplate): string | null {
  if (template.steps.length === 0) return "O fluxo precisa de pelo menos uma etapa.";
  const keys = new Set<string>();
  for (const step of template.steps) {
    if (!step.step_key.trim()) return "Toda etapa precisa de uma chave.";
    if (keys.has(step.step_key)) return `Chave de etapa repetida: ${step.step_key}.`;
    keys.add(step.step_key);
  }
  return null;
}
