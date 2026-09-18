import type { AdminClient } from "@/lib/automations/taskAccess";
import type { TaskSubtypeDef } from "@/lib/taskTypes";

export type WorkflowReader = Pick<AdminClient, "from">;

export type WorkflowStepDef = TaskSubtypeDef & {
  task_type_id: string;
  workflow_step_id: string;
  creation_trigger: "delivery_created" | "ads_report_approved" | "feedback_approved" | "previous_step_approved";
};

export type WorkflowVersionDef = {
  id: string;
  delivery_type_id: string;
  version: number;
  label: string;
  steps: WorkflowStepDef[];
};

type VersionRow = {
  id: string;
  delivery_type_id: string;
  version: number;
  label: string;
};

type StepRow = {
  id: string;
  workflow_version_id: string;
  task_type_id: string;
  step_key: string;
  label: string;
  order_index: number;
  progress_weight: number;
  lead_days: number;
  creation_trigger: WorkflowStepDef["creation_trigger"];
  default_assignee: string | null;
  client_visible: boolean;
};

const VERSION_COLUMNS = "id,delivery_type_id,version,label";
const STEP_COLUMNS = "id,workflow_version_id,task_type_id,step_key,label,order_index,progress_weight,lead_days,creation_trigger,default_assignee,client_visible";

function asStep(row: StepRow): WorkflowStepDef {
  return {
    workflow_step_id: row.id,
    task_type_id: row.task_type_id,
    key: row.step_key,
    label: row.label,
    order_index: row.order_index,
    progress_weight: Number(row.progress_weight) || 1,
    lead_days: row.lead_days,
    creation_trigger: row.creation_trigger,
    default_assignee: row.default_assignee,
    client_visible: row.client_visible,
  };
}

export async function workflowByVersionId(db: WorkflowReader, versionId: string): Promise<WorkflowVersionDef | null> {
  const [{ data: versionRows, error: versionError }, { data: stepRows, error: stepError }] = await Promise.all([
    db.from("workflow_versions").select(VERSION_COLUMNS).eq("id", versionId).limit(1),
    db.from("workflow_version_steps").select(STEP_COLUMNS).eq("workflow_version_id", versionId).order("order_index"),
  ]);
  if (versionError) throw versionError;
  if (stepError) throw stepError;
  const version = (versionRows?.[0] as VersionRow | undefined) ?? null;
  if (!version) return null;
  return {
    ...version,
    steps: ((stepRows ?? []) as StepRow[]).map(asStep),
  };
}

export async function publishedWorkflowForKind(db: WorkflowReader, kind: string): Promise<WorkflowVersionDef | null> {
  // `criativo` e `automacao` são variantes-filhas da raiz estrutural
  // `entrega`. Procurá-las como raiz fazia toda criação de Entrega em produção
  // falhar apesar de a versão publicada existir. A versão é a prova de que o
  // tipo encontrado é uma variante executável; o chamador já valida o behavior.
  const { data: typeRows, error: typeError } = await db
    .from("task_types")
    .select("id")
    .eq("key", kind)
    .limit(1);
  if (typeError) throw typeError;
  const deliveryTypeId = (typeRows?.[0] as { id?: string } | undefined)?.id;
  if (!deliveryTypeId) return null;

  const { data: versionRows, error: versionError } = await db
    .from("workflow_versions")
    .select(VERSION_COLUMNS)
    .eq("delivery_type_id", deliveryTypeId)
    .eq("status", "published")
    .limit(1);
  if (versionError) throw versionError;
  const version = versionRows?.[0] as VersionRow | undefined;
  return version ? workflowByVersionId(db, version.id) : null;
}

export function nextWorkflowStep(workflow: WorkflowVersionDef, currentStepId: string | null | undefined): WorkflowStepDef | null {
  if (!workflow.steps.length) return null;
  if (!currentStepId) return workflow.steps[0];
  const index = workflow.steps.findIndex((step) => step.workflow_step_id === currentStepId);
  return index >= 0 ? workflow.steps[index + 1] ?? null : null;
}

export function workflowStepByKey(workflow: WorkflowVersionDef, key: string): WorkflowStepDef | null {
  return workflow.steps.find((step) => step.key === key) ?? null;
}
