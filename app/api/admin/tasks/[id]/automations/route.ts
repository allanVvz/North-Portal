import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getTaskById, listPerformanceTemplates, updateAutomationConfig } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { bindingVersionIds, compatibleRulesForTask, setTaskRuleBindings, suggestClientPerformanceTemplate } from "@/lib/automations/rules";
import { dailyConfigSchema, HttpError } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUILTIN_PERFORMANCE_TEMPLATES } from "@/lib/performanceTemplates";

async function taskFor(id: string) {
  const parsed = z.string().uuid().parse(id);
  const task = await getTaskById(parsed);
  if (!task) throw new HttpError(404, "Card não encontrado.");
  return task;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const task = await taskFor((await context.params).id);
    const [rules, selected] = await Promise.all([compatibleRulesForTask(task), bindingVersionIds(task.id)]);
    const db = createAdminClient();
    const { data: versions, error } = selected.length
      ? await db.from("automation_rule_versions").select("id,rule_id,version").in("id", selected)
      : { data: [], error: null };
    if (error) throw error;
    const ruleIds = (versions ?? []).map((row) => row.rule_id as string);
    const { data: names, error: nameError } = ruleIds.length
      ? await db.from("automation_rules").select("id,name").in("id", ruleIds)
      : { data: [], error: null };
    if (nameError) throw nameError;
    const byId = new Map((names ?? []).map((row) => [row.id as string, row.name as string]));
    const { data: reportConfig, error: reportError } = await db.from("automation_configs")
      .select("id,automation_key,performance_template_id")
      .eq("target_task_id", task.id).in("automation_key", ["relatorio_trafego_semanal", "relatorio_conversao"]).maybeSingle();
    if (reportError) throw reportError;
    const { data: dailyConfig, error: dailyError } = await db.from("automation_configs")
      .select("id,daily_config").eq("target_task_id", task.id).eq("automation_key", "diaria_recorrente").maybeSingle();
    if (dailyError) throw dailyError;
    const templates = reportConfig ? [...BUILTIN_PERFORMANCE_TEMPLATES, ...await listPerformanceTemplates()]
      .map((template) => ({ id: template.id, name: template.name })) : [];
    const suggestedTemplateId = reportConfig && task.client_id
      ? await suggestClientPerformanceTemplate(db, task.client_id) : null;
    return NextResponse.json({ rules, selected, pinned: (versions ?? []).map((row) => ({
      versionId: row.id, ruleId: row.rule_id, version: row.version, name: byId.get(row.rule_id) ?? "Automação",
    })), reportConfig: reportConfig ? { id: reportConfig.id, templateId: reportConfig.performance_template_id,
      suggestedTemplateId } : null, templates,
      dailyConfig: dailyConfig?.daily_config ? { id: dailyConfig.id, pieces: dailyConfig.daily_config.pieces } : null,
      canConfigure: session.level === "gerente" });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminManager();
    const task = await taskFor((await context.params).id);
    const input = z.union([
      z.object({ performanceTemplateId: z.string().min(1).max(80) }),
      z.object({ dailyQuantities: z.array(z.object({ deliveryTypeId: z.string().uuid(), count: z.number().int().min(0).max(50) })).min(1).max(20) }),
    ]).parse(await request.json());
    if ("dailyQuantities" in input) {
      if (task.kind !== "plano_acao") throw new HttpError(400, "A diária pertence a um Plano.");
      if (new Set(input.dailyQuantities.map((row) => row.deliveryTypeId)).size !== input.dailyQuantities.length ||
        input.dailyQuantities.reduce((sum, row) => sum + row.count, 0) < 1 ||
        input.dailyQuantities.reduce((sum, row) => sum + row.count, 0) > 50) {
        throw new HttpError(400, "Defina de 1 a 50 Criativos sem Subtipos repetidos.");
      }
      const db = createAdminClient();
      const { data: config, error } = await db.from("automation_configs").select("id,daily_config")
        .eq("target_task_id", task.id).eq("automation_key", "diaria_recorrente").maybeSingle();
      if (error) throw error;
      if (!config?.daily_config) throw new HttpError(404, "Diária não configurada neste Plano.");
      const current = dailyConfigSchema.parse(config.daily_config);
      const { data: formats, error: formatError } = await db.from("task_types")
        .select("id,label").in("id", input.dailyQuantities.map((row) => row.deliveryTypeId)).eq("active", true);
      if (formatError) throw formatError;
      const byId = new Map((formats ?? []).map((row) => [row.id as string, row.label as string]));
      const pieces = input.dailyQuantities.flatMap((row) => {
        const label = byId.get(row.deliveryTypeId);
        if (!label) throw new HttpError(400, "Subtipo da diária desativado.");
        const previous = current.pieces.filter((piece) => piece.deliveryTypeId === row.deliveryTypeId);
        return Array.from({ length: row.count }, (_, index) => previous[index] ?? {
          key: crypto.randomUUID(), name: `${label} ${index + 1}`, format: label,
          deliveryTypeId: row.deliveryTypeId, offsetDays: previous[0]?.offsetDays ?? 3,
        });
      });
      await updateAutomationConfig(config.id, { dailyConfig: { ...current, pieces } });
      return NextResponse.json({ pieces });
    }
    const { performanceTemplateId } = input;
    const available = [...BUILTIN_PERFORMANCE_TEMPLATES, ...await listPerformanceTemplates()];
    if (!available.some((template) => template.id === performanceTemplateId)) throw new HttpError(400, "Template não encontrado.");
    const db = createAdminClient();
    const { data, error } = await db.from("automation_configs").update({ performance_template_id: performanceTemplateId })
      .eq("target_task_id", task.id).in("automation_key", ["relatorio_trafego_semanal", "relatorio_conversao"])
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Este card não possui relatório configurado.");
    return NextResponse.json({ performanceTemplateId });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const task = await taskFor((await context.params).id);
    const { versionIds } = z.object({ versionIds: z.array(z.string().uuid()).max(30) }).parse(await request.json());
    await setTaskRuleBindings(task, versionIds, session.userId);
    return NextResponse.json({ selected: await bindingVersionIds(task.id) });
  } catch (error) { return apiError(error); }
}
