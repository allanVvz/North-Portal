import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_STATUSES, HttpError, type TaskRecord } from "@/lib/validation";
import type { DailyConfig } from "@/lib/validation";
import { createAutomationConfig, updateAutomationConfig } from "@/lib/supabase";
import { publishedWorkflowForKind } from "@/lib/workflows";
import { ensureClientDailyFolders, ensureClientDriveRoot } from "./clientFolders";
import { ensureDailySeries } from "./dailySeries";
import { suggestPerformanceTemplate } from "@/lib/performanceTemplateSuggestion";
import type { MetaPost } from "@/lib/windsor";
import { listPerformanceTemplates } from "@/lib/supabase";
import { BUILTIN_PERFORMANCE_TEMPLATES } from "@/lib/performanceTemplates";

const uuid = z.string().uuid();
const status = z.enum(TASK_STATUSES);
export const ruleDefinitionSchema = z.object({
  sourceTypeId: uuid,
  sourceSubtypeId: uuid.nullable(),
  workflowVersionId: uuid.nullable(),
  workflowStepId: uuid.nullable(),
  triggerKind: z.enum(["status_transition", "recurrence_occurrence"]),
  fromStatus: status.nullable(),
  toStatus: status.nullable(),
  actionKind: z.enum(["create_card", "change_status", "ai", "drive", "report", "daily", "provision"]),
  actionConfig: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(10000).optional(),
    dueOffsetDays: z.number().int().min(-30).max(365).optional(),
    status: status.optional(),
    instruction: z.string().trim().min(1).max(3000).optional(),
    automationKey: z.enum(["relatorio_trafego_semanal", "relatorio_conversao", "diaria_recorrente", "provisionar_card_metricas"]).optional(),
    performanceTemplateId: z.string().max(80).nullable().optional(),
    dailyQuantities: z.array(z.object({
      deliveryTypeId: uuid,
      count: z.number().int().min(0).max(50),
      offsetDays: z.number().int().min(-30).max(180),
    })).max(20).optional(),
  }).strict(),
  outputTypeId: uuid.nullable(),
  outputSubtypeId: uuid.nullable(),
}).superRefine((value, ctx) => {
  if (value.triggerKind === "status_transition" && (!value.fromStatus || !value.toStatus || value.fromStatus === value.toStatus)) {
    ctx.addIssue({ code: "custom", message: "Escolha dois status diferentes para o gatilho." });
  }
  if (value.triggerKind === "recurrence_occurrence" && (value.fromStatus || value.toStatus)) {
    ctx.addIssue({ code: "custom", message: "O gatilho de ocorrência usa a recorrência do card." });
  }
  if (Boolean(value.workflowVersionId) !== Boolean(value.workflowStepId)) {
    ctx.addIssue({ code: "custom", message: "Informe a versão e a etapa da cascata juntas." });
  }
  if (value.actionKind === "create_card" && !value.outputTypeId) {
    ctx.addIssue({ code: "custom", message: "Escolha o Tipo de saída." });
  }
  if (value.actionKind === "change_status" && !value.actionConfig.status) {
    ctx.addIssue({ code: "custom", message: "Escolha o status da ação." });
  }
  if (value.actionKind === "ai" && !value.actionConfig.instruction) {
    ctx.addIssue({ code: "custom", message: "Descreva a ação da North AI." });
  }
  if (value.actionKind === "report" && !["relatorio_trafego_semanal", "relatorio_conversao"].includes(value.actionConfig.automationKey ?? "")) {
    ctx.addIssue({ code: "custom", message: "Escolha o relatório de anúncios ou conversão." });
  }
  if (value.actionKind === "daily" && value.actionConfig.automationKey !== "diaria_recorrente") {
    ctx.addIssue({ code: "custom", message: "A ação de diária precisa usar o executor da diária." });
  }
  if (value.actionKind === "daily" && !(value.actionConfig.dailyQuantities?.some((item) => item.count > 0))) {
    ctx.addIssue({ code: "custom", message: "Defina ao menos uma Entrega para a diária." });
  }
  if (value.actionKind === "provision" && value.actionConfig.automationKey !== "provisionar_card_metricas") {
    ctx.addIssue({ code: "custom", message: "A ação de provisionamento precisa usar o executor de provisionamento." });
  }
  if (["report", "daily", "provision"].includes(value.actionKind) && value.triggerKind !== "recurrence_occurrence") {
    ctx.addIssue({ code: "custom", message: "Esta ação usa a ocorrência e a data do próprio card." });
  }
});

export const publishRuleSchema = z.object({
  id: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  active: z.boolean(),
  definition: ruleDefinitionSchema,
});

export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;
export type GlobalRule = {
  id: string;
  name: string;
  active: boolean;
  versionId: string;
  version: number;
  definition: RuleDefinition;
};

type RuleRow = { id: string; name: string; active: boolean; current_version_id: string | null };
type VersionRow = {
  id: string; rule_id: string; version: number;
  source_type_id: string; source_subtype_id: string | null;
  workflow_version_id: string | null; workflow_step_id: string | null;
  trigger_kind: RuleDefinition["triggerKind"]; from_status: RuleDefinition["fromStatus"]; to_status: RuleDefinition["toStatus"];
  action_kind: RuleDefinition["actionKind"]; action_config: RuleDefinition["actionConfig"];
  output_type_id: string | null; output_subtype_id: string | null;
};

function mapRule(row: RuleRow, version: VersionRow): GlobalRule {
  return { id: row.id, name: row.name, active: row.active, versionId: version.id, version: version.version,
    definition: {
      sourceTypeId: version.source_type_id, sourceSubtypeId: version.source_subtype_id,
      workflowVersionId: version.workflow_version_id, workflowStepId: version.workflow_step_id,
      triggerKind: version.trigger_kind, fromStatus: version.from_status, toStatus: version.to_status,
      actionKind: version.action_kind, actionConfig: version.action_config,
      outputTypeId: version.output_type_id, outputSubtypeId: version.output_subtype_id,
    } };
}

export async function listGlobalAutomationRules(): Promise<GlobalRule[]> {
  const db = createAdminClient();
  const { data: rows, error } = await db.from("automation_rules")
    .select("id,name,active,current_version_id").order("created_at", { ascending: true });
  if (error) throw error;
  const ids = ((rows ?? []) as RuleRow[]).map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const { data: versions, error: versionError } = await db.from("automation_rule_versions").select("*").in("id", ids);
  if (versionError) throw versionError;
  const byId = new Map(((versions ?? []) as VersionRow[]).map((row) => [row.id, row]));
  return ((rows ?? []) as RuleRow[]).flatMap((row) => {
    const version = row.current_version_id && byId.get(row.current_version_id);
    return version ? [mapRule(row, version)] : [];
  });
}

export async function publishGlobalAutomationRule(raw: unknown, createdBy: string): Promise<GlobalRule> {
  const input = publishRuleSchema.parse(raw);
  const db = createAdminClient();
  if (input.definition.actionKind === "report" && input.definition.actionConfig.performanceTemplateId) {
    const templates = [...BUILTIN_PERFORMANCE_TEMPLATES, ...await listPerformanceTemplates()];
    if (!templates.some((item) => item.id === input.definition.actionConfig.performanceTemplateId)) {
      throw new HttpError(400, "Template de Performance não encontrado.");
    }
  }
  if (input.definition.actionKind === "daily") {
    const { data: source, error: sourceError } = await db.from("task_types")
      .select("key").eq("id", input.definition.sourceTypeId).maybeSingle();
    if (sourceError) throw sourceError;
    if (source?.key !== "plano") throw new HttpError(400, "A diária começa em um Plano.");
    const total = (input.definition.actionConfig.dailyQuantities ?? []).reduce((sum, row) => sum + row.count, 0);
    if (total > 50) throw new HttpError(400, "A diária aceita até 50 Entregas por ocorrência.");
    const quantities = input.definition.actionConfig.dailyQuantities ?? [];
    if (new Set(quantities.map((row) => row.deliveryTypeId)).size !== quantities.length) {
      throw new HttpError(400, "Subtipo repetido na diária.");
    }
    const baseWorkflow = await publishedWorkflowForKind(db, "criativo");
    const scriptType = baseWorkflow?.steps.find((step) => step.key === "roteiro")?.task_type_id;
    const captureType = baseWorkflow?.steps.find((step) => step.key === "captacao")?.task_type_id;
    if (!scriptType || !captureType) throw new HttpError(409, "Publique a cascata principal com Roteiro e Captação.");
    const ids = quantities.filter((row) => row.count > 0).map((row) => row.deliveryTypeId);
    const { data: formats, error: formatsError } = await db.from("task_types").select("id,key,active,behavior").in("id", ids);
    if (formatsError) throw formatsError;
    for (const id of ids) {
      const format = formats?.find((item) => item.id === id);
      if (!format?.active || format.behavior !== "entrega") throw new HttpError(400, "Subtipo da diária indisponível.");
      const workflow = await publishedWorkflowForKind(db, format.key);
      if (workflow?.steps[0]?.key !== "roteiro" ||
        workflow.steps.find((step) => step.key === "roteiro")?.task_type_id !== scriptType ||
        workflow.steps.find((step) => step.key === "captacao")?.task_type_id !== captureType) {
        throw new HttpError(409, `Publique uma cascata compatível para ${format.key}.`);
      }
    }
  }
  const { data, error } = await db.rpc("publish_automation_rule", {
    p_rule_id: input.id ?? null, p_name: input.name, p_active: input.active,
    p_definition: input.definition, p_created_by: createdBy,
  });
  if (error) throw error;
  const version = data as VersionRow;
  return mapRule({ id: version.rule_id, name: input.name, active: input.active, current_version_id: version.id }, version);
}

const projection: Record<string, string> = { tarefa: "operacional", plano: "plano_acao", checkpoint: "checkpoint_comercial" };

export async function ruleMatchesTask(rule: GlobalRule, task: TaskRecord): Promise<boolean> {
  const db = createAdminClient();
  const { data: rows, error } = await db.from("task_types").select("id,key,parent_id")
    .in("id", [rule.definition.sourceTypeId, rule.definition.sourceSubtypeId].filter((v): v is string => Boolean(v)));
  if (error) throw error;
  const types = new Map(((rows ?? []) as { id: string; key: string; parent_id: string | null }[]).map((row) => [row.id, row]));
  const type = types.get(rule.definition.sourceTypeId);
  const subtype = rule.definition.sourceSubtypeId ? types.get(rule.definition.sourceSubtypeId) : null;
  if (!type || (subtype && subtype.parent_id !== type.id)) return false;
  if (type.key === "entrega") {
    if (!subtype || task.kind !== subtype.key) return false;
  } else if (task.kind !== (projection[type.key] ?? type.key) || (subtype && task.subtype !== subtype.key)) {
    return false;
  }
  if (rule.definition.workflowStepId) {
    const { data: links, error: linksError } = await db.from("task_links")
      .select("workflow_step_id").eq("child_id", task.id).eq("relation_kind", "workflow_step")
      .eq("workflow_step_id", rule.definition.workflowStepId).limit(1);
    if (linksError) throw linksError;
    if (!links?.length) return false;
  }
  return true;
}

export async function compatibleRulesForTask(task: TaskRecord): Promise<GlobalRule[]> {
  const rules = (await listGlobalAutomationRules()).filter((rule) => rule.active);
  const matches = await Promise.all(rules.map((rule) => ruleMatchesTask(rule, task)));
  return rules.filter((_, index) => matches[index]);
}

async function ensureReportExecutor(task: TaskRecord, rule: GlobalRule, createdBy: string): Promise<void> {
  const key = rule.definition.actionConfig.automationKey;
  if (rule.definition.actionKind !== "report" || !key) return;
  if (!task.client_id) throw new HttpError(409, "O card precisa pertencer a um cliente para gerar relatórios.");
  const db = createAdminClient();
  const suggestedTemplateId = await suggestClientPerformanceTemplate(db, task.client_id);
  const templateId = rule.definition.actionConfig.performanceTemplateId ?? suggestedTemplateId;
  const { data: existing, error: existingError } = await db.from("automation_configs")
    .select("id,automation_key,automation_rule_version_id,performance_template_id").eq("target_task_id", task.id).limit(1);
  if (existingError) throw existingError;
  const config = existing?.[0];
  if (config) {
    if (config.automation_key !== key) throw new HttpError(409, "Este card já possui outro executor operacional.");
    // Legacy configs, including Baita, deliberately keep their own template.
    if (!config.automation_rule_version_id) return;
    const { error } = await db.from("automation_configs").update({
      automation_rule_version_id: rule.versionId,
      performance_template_id: config.performance_template_id ?? templateId,
      active: true,
    }).eq("id", config.id);
    if (error) throw error;
    return;
  }
  const { data, error } = await db.rpc("create_automation_config_with_dependency", {
    p_automation_key: key, p_target_task_id: task.id,
    p_performance_template_id: templateId,
    p_active: true, p_collect_metric_keys: null, p_created_by: createdBy,
  });
  if (error) throw error;
  const created = (data as Array<{ id: string }> | null)?.[0];
  if (!created?.id) throw new HttpError(503, "O executor do relatório não foi criado.");
  const { error: markError } = await db.from("automation_configs")
    .update({ automation_rule_version_id: rule.versionId }).eq("id", created.id);
  if (markError) throw markError;
}

export async function suggestClientPerformanceTemplate(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<string> {
  const { data, error } = await db.from("traffic_reports")
    .select("snapshot").eq("client_id", clientId).order("period_to", { ascending: false }).limit(1);
  if (error) throw error;
  const posts = (data?.[0]?.snapshot as { campaignPosts?: MetaPost[] } | undefined)?.campaignPosts ?? [];
  return suggestPerformanceTemplate(posts)?.id ?? "builtin-por-resultado";
}

async function ensureDailyExecutor(task: TaskRecord, rule: GlobalRule, createdBy: string): Promise<void> {
  if (rule.definition.actionKind !== "daily") return;
  if (task.kind !== "plano_acao" || !task.client_id || !task.due_date) {
    throw new HttpError(409, "A diária precisa de um Plano com cliente e data.");
  }
  const db = createAdminClient();
  const { data: existing, error: existingError } = await db.from("automation_configs")
    .select("id,automation_key,automation_rule_version_id,daily_config")
    .eq("target_task_id", task.id).limit(1);
  if (existingError) throw existingError;
  const prior = existing?.[0];
  if (prior && prior.automation_key !== "diaria_recorrente") throw new HttpError(409, "Este Plano já possui outro executor operacional.");
  if (prior && !prior.automation_rule_version_id) return; // legacy Baita remains untouched
  const workflow = await publishedWorkflowForKind(db, "criativo");
  if (!workflow) throw new HttpError(409, "Publique a cascata de Criativo antes de ativar a diária.");
  const quantities = rule.definition.actionConfig.dailyQuantities ?? [];
  const formatIds = quantities.filter((item) => item.count > 0).map((item) => item.deliveryTypeId);
  const { data: formats, error: formatsError } = await db.from("task_types").select("id,key,label")
    .in("id", formatIds);
  if (formatsError) throw formatsError;
  const byId = new Map((formats ?? []).map((row) => [row.id as string, row]));
  const pieces: DailyConfig["pieces"] = [];
  for (const quantity of quantities) {
    const format = byId.get(quantity.deliveryTypeId);
    if (quantity.count > 0 && !format) throw new HttpError(409, "Um Subtipo da diária foi desativado.");
    for (let index = 0; index < quantity.count; index += 1) {
      pieces.push({ key: crypto.randomUUID(), name: `Peça ${pieces.length + 1}`,
        format: format!.label, deliveryTypeId: quantity.deliveryTypeId, offsetDays: quantity.offsetDays });
    }
  }
  if (!pieces.length) throw new HttpError(400, "Defina as quantidades da diária.");
  await ensureClientDailyFolders(db, task.client_id);
  const old = prior?.daily_config as DailyConfig | null;
  const dailyConfig: DailyConfig = { clientId: task.client_id, deliveryTypeId: workflow.delivery_type_id,
    pieces: old?.pieces?.length ? old.pieces : pieces,
    ...(old?.scriptDocUrl ? { scriptDocUrl: old.scriptDocUrl } : {}),
    ...(old?.seriesFolderId ? { seriesFolderId: old.seriesFolderId } : {}) };
  const saved = prior
    ? await updateAutomationConfig(prior.id, { dailyConfig, active: true })
    : await createAutomationConfig({ automationKey: "diaria_recorrente", targetTaskId: task.id,
      dailyConfig, active: true }, createdBy);
  const { error: markerError } = await db.from("automation_configs")
    .update({ automation_rule_version_id: rule.versionId }).eq("id", saved.id);
  if (markerError) throw markerError;
  try { await ensureDailySeries(db, saved.id); }
  catch (error) {
    await db.from("automation_configs").update({ active: false }).eq("id", saved.id);
    throw error;
  }
}

export async function setTaskRuleBindings(task: TaskRecord, versionIds: string[], createdBy: string): Promise<void> {
  if (new Set(versionIds).size !== versionIds.length) throw new HttpError(400, "Automação repetida.");
  const db = createAdminClient();
  const { data: existing, error } = await db.from("task_automation_bindings")
    .select("id,rule_id,rule_version_id").eq("task_id", task.id);
  if (error) throw error;
  const compatible = await compatibleRulesForTask(task);
  const prior = (existing ?? []) as { id: string; rule_id: string; rule_version_id: string }[];
  const chosen = versionIds.map((id) => compatible.find((rule) => rule.versionId === id)
    ?? prior.find((row) => row.rule_version_id === id));
  if (chosen.some((rule) => !rule)) throw new HttpError(409, "Uma das automações não é compatível com o Tipo, Subtipo ou versão da cascata deste card.");
  const selected = new Set(chosen.map((rule) => "rule_id" in rule! ? rule!.rule_id : rule!.id));
  if (selected.size !== chosen.length) throw new HttpError(400, "Escolha somente uma versão de cada automação.");
  for (const row of prior) {
    if (selected.has(row.rule_id)) continue;
    const { error: stopError } = await db.from("automation_configs").update({ active: false })
      .eq("target_task_id", task.id).eq("automation_rule_version_id", row.rule_version_id);
    if (stopError) throw stopError;
    const removed = await db.from("task_automation_bindings").delete().eq("id", row.id);
    if (removed.error) throw removed.error;
  }
  for (const rule of chosen) {
    if (!("rule_id" in rule!)) {
      await ensureReportExecutor(task, rule!, createdBy);
      await ensureDailyExecutor(task, rule!, createdBy);
      if (rule!.definition.actionKind === "drive") {
        if (!task.client_id) throw new HttpError(409, "Vincule o card a um cliente para usar o Drive.");
        await ensureClientDriveRoot(db, task.client_id);
      }
    }
    const ruleId = "rule_id" in rule! ? rule!.rule_id : rule!.id;
    const versionId = "rule_version_id" in rule! ? rule!.rule_version_id : rule!.versionId;
    const saved = await db.from("task_automation_bindings").upsert({
      task_id: task.id, rule_id: ruleId, rule_version_id: versionId, active: true,
    }, { onConflict: "task_id,rule_id" });
    if (saved.error) throw saved.error;
  }
}

export async function bindingVersionIds(taskId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("task_automation_bindings")
    .select("rule_version_id").eq("task_id", taskId).eq("active", true);
  if (error) throw error;
  return ((data ?? []) as { rule_version_id: string }[]).map((row) => row.rule_version_id);
}
