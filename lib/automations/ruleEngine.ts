import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import { derivedTaskId } from "@/lib/derivedTaskId";
import { publishedWorkflowForKind } from "@/lib/workflows";
import { materializeFirstStep, advanceFlowAfterUpdate } from "@/lib/flows/advance";
import { approveTask } from "@/lib/flows/approve";
import { transitionTaskStatus, updateTaskPayload } from "./taskWrites";
import { asTaskRecord, errorMessage, type AdminClient } from "./taskAccess";
import { aiComplete } from "@/lib/ai/complete";
import { getDriveItemMetadata } from "@/lib/googleDriveApi";
import { provisionCreativeDriveWorkspaceIfConfigured } from "@/lib/creativeDrive";
import { recurrenceOccursOn, recurrenceRuleOf } from "@/lib/recurrence";
import type { TaskRecord } from "@/lib/validation";
import { ruleMatchesTask, type GlobalRule, type RuleDefinition } from "./rules";
import { provisionFromTemplate } from "./provision";

type BoundRow = { rule_version_id: string; automation_rule_versions: Record<string, unknown> | null };
type RuleRow = { id: string; name: string; active: boolean };
type EventSummary = { processed: number; succeeded: number; errors: Array<{ taskId: string; message: string }> };

export const statusEventKey = (versionId: string, taskId: string, from: string, to: string, updatedAt: string) =>
  `${versionId}:${taskId}:status:${from}:${to}:${updatedAt}`;
export const occurrenceEventKey = (versionId: string, taskId: string, day: string) =>
  `${versionId}:${taskId}:occurrence:${day}`;

function ruleFromVersion(rule: RuleRow, version: Record<string, unknown>): GlobalRule {
  return { id: rule.id, name: rule.name, active: rule.active,
    versionId: version.id as string, version: version.version as number,
    definition: {
      sourceTypeId: version.source_type_id as string,
      sourceSubtypeId: version.source_subtype_id as string | null,
      workflowVersionId: version.workflow_version_id as string | null,
      workflowStepId: version.workflow_step_id as string | null,
      triggerKind: version.trigger_kind as RuleDefinition["triggerKind"],
      fromStatus: version.from_status as RuleDefinition["fromStatus"],
      toStatus: version.to_status as RuleDefinition["toStatus"],
      actionKind: version.action_kind as RuleDefinition["actionKind"],
      actionConfig: version.action_config as RuleDefinition["actionConfig"],
      outputTypeId: version.output_type_id as string | null,
      outputSubtypeId: version.output_subtype_id as string | null,
    } };
}

async function rulesBoundTo(admin: AdminClient, taskId: string): Promise<GlobalRule[]> {
  const { data: bindings, error } = await admin.from("task_automation_bindings")
    .select("rule_version_id,automation_rule_versions(*)").eq("task_id", taskId).eq("active", true);
  if (error) throw error;
  const versions = (bindings ?? []) as unknown as BoundRow[];
  if (!versions.length) return [];
  const ruleIds = versions.map((row) => row.automation_rule_versions?.rule_id as string).filter(Boolean);
  const { data: rules, error: ruleError } = await admin.from("automation_rules")
    .select("id,name,active").in("id", ruleIds).eq("active", true);
  if (ruleError) throw ruleError;
  const byId = new Map(((rules ?? []) as RuleRow[]).map((row) => [row.id, row]));
  return versions.flatMap((item) => {
    const version = item.automation_rule_versions;
    const rule = version && byId.get(version.rule_id as string);
    return rule && version ? [ruleFromVersion(rule, version)] : [];
  });
}

function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function createOutputCard(admin: AdminClient, task: TaskRecord, rule: GlobalRule, day: string, eventKey: string): Promise<string> {
  const d = rule.definition;
  if (!d.outputTypeId) throw new Error("Tipo de saída não configurado.");
  const { data: types, error: typeError } = await admin.from("task_types")
    .select("id,key,behavior,parent_id").in("id", [d.outputTypeId, d.outputSubtypeId].filter((v): v is string => Boolean(v)));
  if (typeError) throw typeError;
  const output = (types ?? []).find((row) => row.id === d.outputTypeId);
  const subtype = (types ?? []).find((row) => row.id === d.outputSubtypeId);
  if (!output || (subtype && subtype.parent_id !== output.id)) throw new Error("Classificação de saída inválida.");
  const kind = output.key === "tarefa" ? "operacional" : output.key === "plano" ? "plano_acao"
    : output.key === "checkpoint" ? "checkpoint_comercial" : output.key;
  const workflow = output.behavior === "entrega" ? await publishedWorkflowForKind(admin, kind) : null;
  if (output.behavior === "entrega" && !workflow) throw new Error("Publique a cascata da Entrega de saída antes de executar.");
  const id = derivedTaskId(task.id, `automation:${eventKey}`);
  const { data: prior, error: priorError } = await admin.from("tasks").select("id").eq("id", id).limit(1);
  if (priorError) throw priorError;
  if (!prior?.length) {
    const { error } = await admin.from("tasks").insert({
      id, client_id: task.client_id, kind, subtype: subtype?.key ?? null,
      task_type_id: workflow?.delivery_type_id ?? subtype?.id ?? output.id,
      workflow_version_id: workflow?.id ?? null,
      title: d.actionConfig.title || `${rule.name} · ${task.title}`,
      description: d.actionConfig.description ?? null,
      status: "backlog", priority: task.priority, assignee: task.assignee,
      due_date: addDays(day, d.actionConfig.dueOffsetDays ?? 0),
      start_date: addDays(day, d.actionConfig.dueOffsetDays ?? 0),
      payload: { automation_rule_version_id: rule.versionId, automation_source_task_id: task.id },
    });
    if (error && error.code !== "23505") throw error;
  }
  if (workflow) {
    const { data: delivery, error } = await admin.from("tasks").select(TASK_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (delivery) await materializeFirstStep(admin, asTaskRecord(delivery));
  }
  const { error: linkError } = await admin.from("task_links").upsert({
    parent_id: task.id, child_id: id,
    relation_kind: task.kind === "plano_acao" ? "structural_member" : "reference",
    position: 0,
  }, { onConflict: "parent_id,child_id" });
  if (linkError) throw linkError;
  return id;
}

async function executeAction(admin: AdminClient, task: TaskRecord, rule: GlobalRule, day: string, eventKey: string): Promise<string | null> {
  const d = rule.definition;
  if (d.actionKind === "create_card") return createOutputCard(admin, task, rule, day, eventKey);
  if (d.actionKind === "change_status") {
    const next = d.actionConfig.status;
    if (!next || task.status === next) return null;
    if (next === "aprovado") await approveTask(admin, task, { from: [task.status] });
    else {
      const changed = await transitionTaskStatus(admin, task.id, { from: [task.status], to: next });
      if (changed) await advanceFlowAfterUpdate(task, changed, null);
    }
    return null;
  }
  if (d.actionKind === "ai") {
    const result = await aiComplete({ system: "Você auxilia a operação da North. Responda apenas com o resultado pedido, em português.",
      user: `${d.actionConfig.instruction}\n\nCard: ${task.title}\nDescrição: ${task.description ?? ""}`, maxTokens: 700 });
    await updateTaskPayload(admin, task.id, { text: result, commentId: eventKey });
    return null;
  }
  if (d.actionKind === "drive") {
    if (task.workflow_version_id) {
      await provisionCreativeDriveWorkspaceIfConfigured(admin, task.id);
    } else {
      if (!task.client_id) throw new Error("Vincule o card a um cliente para usar o Drive.");
      const { data, error } = await admin.from("client_drive_links").select("root_folder_id")
        .eq("client_id", task.client_id).maybeSingle();
      if (error) throw error;
      if (!data?.root_folder_id || !(await getDriveItemMetadata(data.root_folder_id))) {
        throw new Error("Raiz do cliente não acessível no Google Drive.");
      }
    }
    return null;
  }
  if (d.actionKind === "provision") {
    const summary = await provisionFromTemplate(task.id, eventKey);
    if (summary.errors.length) throw new Error(`${summary.errors.length} cliente(s) com erro: ${summary.errors.map((item) => item.clientSlug).join(", ")}`);
    await updateTaskPayload(admin, task.id, {
      text: `${summary.provisioned} cliente(s) provisionado(s) nesta ocorrência.`,
      commentId: `automation-provision:${eventKey}`,
    });
    return null;
  }
  // Report, daily and provision actions use the existing, validated
  // automation_configs executors. Their binding adapter is installed when a
  // rule is adopted; the old executor owns its occurrence ledger and comments.
  throw new Error("Vincule esta ação a um executor operacional antes de ativá-la.");
}

async function executeEvent(admin: AdminClient, task: TaskRecord, rule: GlobalRule, day: string, eventKey: string): Promise<"succeeded" | "skipped" | string> {
  const { error: claimError } = await admin.from("automation_rule_events").insert({
    event_key: eventKey, rule_version_id: rule.versionId, task_id: task.id, occurrence_date: day,
  });
  if (claimError?.code === "23505") {
    const { data: retry, error: retryError } = await admin.from("automation_rule_events")
      .update({ state: "running", error: null, finished_at: null })
      .eq("event_key", eventKey).eq("state", "failed").select("event_key").limit(1);
    if (retryError) throw retryError;
    if (!retry?.length) return "skipped";
  } else if (claimError) {
    throw claimError;
  }
  try {
    const outputTaskId = await executeAction(admin, task, rule, day, eventKey);
    const { error } = await admin.from("automation_rule_events").update({
      state: "succeeded", output_task_id: outputTaskId, finished_at: new Date().toISOString(),
    }).eq("event_key", eventKey);
    if (error) throw error;
    await updateTaskPayload(admin, task.id, {
      text: outputTaskId ? `${rule.name} v${rule.version} criou um card vinculado.` : `${rule.name} v${rule.version} concluída.`,
      commentId: `automation-event:${eventKey}`,
    });
    return "succeeded";
  } catch (cause) {
    const message = errorMessage(cause);
    await admin.from("automation_rule_events").update({ state: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("event_key", eventKey);
    await updateTaskPayload(admin, task.id, { text: `${rule.name}: ${message}`, commentId: `automation-error:${eventKey}` });
    return message;
  }
}

export async function runStatusRuleEvents(before: TaskRecord, after: TaskRecord): Promise<void> {
  if (before.status === after.status) return;
  const admin = createAdminClient();
  const rules = await rulesBoundTo(admin, after.id);
  for (const rule of rules) {
    const d = rule.definition;
    if (d.triggerKind !== "status_transition" || d.fromStatus !== before.status || d.toStatus !== after.status) continue;
    if (!(await ruleMatchesTask(rule, after))) continue;
    const day = after.updated_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    await executeEvent(admin, after, rule, day, statusEventKey(rule.versionId, after.id, before.status, after.status, after.updated_at));
  }
}

export async function runOccurrenceRuleEvents(today: string): Promise<EventSummary> {
  const admin = createAdminClient();
  const summary: EventSummary = { processed: 0, succeeded: 0, errors: [] };
  const { data: bindings, error } = await admin.from("task_automation_bindings")
    .select("task_id").eq("active", true);
  if (error) throw error;
  const taskIds = [...new Set((bindings ?? []).map((row) => row.task_id as string))];
  if (!taskIds.length) return summary;
  const { data: tasks, error: taskError } = await admin.from("tasks").select(TASK_COLUMNS).in("id", taskIds);
  if (taskError) throw taskError;
  for (const row of tasks ?? []) {
    const task = asTaskRecord(row);
    if (task.status === "aprovado" || task.status === "parada") continue;
    const recurrence = recurrenceRuleOf(task);
    if (recurrence ? !recurrenceOccursOn(recurrence, today) : task.kind !== "plano_acao" || task.due_date !== today) continue;
    const rules = await rulesBoundTo(admin, task.id);
    for (const rule of rules) {
      if (rule.definition.triggerKind !== "recurrence_occurrence" || !(await ruleMatchesTask(rule, task))) continue;
      if (rule.definition.actionKind === "report" || rule.definition.actionKind === "daily") continue;
      summary.processed += 1;
      const outcome = await executeEvent(admin, task, rule, today, occurrenceEventKey(rule.versionId, task.id, today));
      if (outcome === "succeeded") summary.succeeded += 1;
      else if (outcome !== "skipped") summary.errors.push({ taskId: task.id, message: outcome });
    }
  }
  return summary;
}
