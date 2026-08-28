// Automação 2 (provisionar_card_metricas) — the synchronous fan-out
// triggered when an admin saves the automation with a target card
// (POST /api/admin/automations/provision). Clones the chosen card to every
// client with at least 1 task_metrics row, branching by the card's own shape
// (task normal / rotina / plano de ação) — see
// plan/AUTOMACOES-RELATORIO-TRAFEGO.md "Automação 2". The exact wording of
// the metrics summary comment, and how plan "itens atribuídos" get
// redistributed per client, are explicitly left open by that plan for a
// later pass — this only fixes the mechanism (clone + branch by format).

import { createAdminClient } from "@/lib/supabase/admin";
import { TASK_COLUMNS } from "@/lib/taskColumns";
import type { TaskComment, TaskRecord } from "@/lib/validation";
import { listMetricsEligibleClientIds } from "./serviceIntegrations";
import { asTaskRecord, errorMessage, getAdminTask, AUTOMATION_ASSIGNEE, type AdminClient } from "./taskAccess";
import { markTaskParada } from "./errorHandling";

async function metricsSummaryComment(admin: AdminClient, clientId: string): Promise<string> {
  const { data, error } = await admin
    .from("task_metrics")
    .select("metrics")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { metrics: Record<string, string> } | undefined;
  if (!row || Object.keys(row.metrics).length === 0) return "Sem métricas registradas ainda.";
  return Object.entries(row.metrics).map(([key, value]) => `${key}: ${value}`).join(" · ");
}

function withAppendedComment(payload: Record<string, unknown> | null | undefined, comment: TaskComment): Record<string, unknown> {
  const existing = payload ?? {};
  const comments = Array.isArray(existing.comments) ? (existing.comments as TaskComment[]) : [];
  return { ...existing, comments: [...comments, comment].slice(-200) };
}

// Caso 1 (task normal) e caso 2 (card recorrente): mesma cópia — recurrence_*
// é copiado verbatim do modelo, o que já preserva a cadência quando o modelo
// é uma rotina.
async function cloneSimpleTask(admin: AdminClient, template: TaskRecord, clientId: string, comment: string): Promise<TaskRecord> {
  const id = crypto.randomUUID();
  const payload = withAppendedComment(template.payload, { author: "Automação", text: comment, at: new Date().toISOString() });
  const fields = {
    id,
    client_id: clientId,
    kind: template.kind,
    subtype: template.subtype,
    title: template.title,
    status: "backlog",
    priority: template.priority,
    assignee: AUTOMATION_ASSIGNEE,
    reviewer_id: null,
    approver_id: null,
    plan_id: null,
    requires_review: template.requires_review,
    requires_approval: template.requires_approval,
    due_date: template.due_date,
    start_date: template.start_date,
    end_date: template.end_date,
    scheduled_start_at: null,
    scheduled_end_at: null,
    progress_weight: template.progress_weight,
    description: template.description,
    client_visible: template.client_visible,
    payload,
    position: 0,
    recurrence_cadence: template.recurrence_cadence,
    recurrence_weekdays: template.recurrence_weekdays,
    recurrence_day_of_month: template.recurrence_day_of_month,
  };
  const { data, error } = await admin.from("tasks").insert(fields).select(TASK_COLUMNS).limit(1);
  if (error) throw error;
  return asTaskRecord(data![0]);
}

// Caso 3 (plano de ação): clone estrutural — o pai + todos os membros
// (plan_id = pai.id), client_id trocado. Reatribuição de "itens atribuídos"
// por responsável fica para depois (ver cabeçalho do arquivo). Exported —
// lib/automations/execute.ts reuses this exact mechanism for Automação 1's
// plano_acao branch (a new instance of the plan gets created on the plan's
// own due date, not just on "Provisionar agora").
export async function clonePlan(admin: AdminClient, templateParent: TaskRecord, clientId: string): Promise<TaskRecord> {
  const { data: memberRows, error: membersError } = await admin.from("tasks").select(TASK_COLUMNS).eq("plan_id", templateParent.id);
  if (membersError) throw membersError;
  const members = (memberRows ?? []).map(asTaskRecord);

  const parentId = crypto.randomUUID();
  const { data: parentData, error: parentError } = await admin
    .from("tasks")
    .insert({
      id: parentId,
      client_id: clientId,
      kind: "plano_acao",
      subtype: templateParent.subtype,
      title: templateParent.title,
      status: "backlog",
      priority: templateParent.priority,
      assignee: AUTOMATION_ASSIGNEE,
      reviewer_id: null,
      approver_id: null,
      plan_id: null,
      requires_review: templateParent.requires_review,
      requires_approval: templateParent.requires_approval,
      due_date: templateParent.due_date,
      start_date: templateParent.start_date,
      end_date: templateParent.end_date,
      scheduled_start_at: null,
      scheduled_end_at: null,
      progress_weight: templateParent.progress_weight,
      description: templateParent.description,
      client_visible: templateParent.client_visible,
      payload: templateParent.payload,
      position: 0,
    })
    .select(TASK_COLUMNS)
    .limit(1);
  if (parentError) throw parentError;
  const parent = asTaskRecord(parentData![0]);

  try {
    for (const member of members) {
      const { error: memberError } = await admin.from("tasks").insert({
        id: crypto.randomUUID(),
        client_id: clientId,
        kind: member.kind,
        subtype: member.subtype,
        title: member.title,
        status: "backlog",
        priority: member.priority,
        assignee: AUTOMATION_ASSIGNEE,
        reviewer_id: null,
        approver_id: null,
        plan_id: parent.id,
        requires_review: member.requires_review,
        requires_approval: member.requires_approval,
        due_date: member.due_date,
        start_date: member.start_date,
        end_date: member.end_date,
        scheduled_start_at: null,
        scheduled_end_at: null,
        progress_weight: member.progress_weight,
        description: member.description,
        client_visible: member.client_visible,
        payload: member.payload,
        position: member.position,
      });
      if (memberError) throw memberError;
    }
  } catch (error) {
    // Partial plan (parent exists, some members missing) — surface it on the
    // parent itself instead of leaving a silently incomplete clone.
    await markTaskParada(admin, parent.id, `Falha ao clonar os itens do plano: ${errorMessage(error)}`);
    throw error;
  }
  return parent;
}

export type ProvisionSummary = { provisioned: number; skipped: number; errors: { clientSlug: string; message: string }[] };

export async function provisionFromTemplate(templateTaskId: string): Promise<ProvisionSummary> {
  const admin = createAdminClient();
  const template = await getAdminTask(admin, templateTaskId);
  if (!template) throw new Error("Card-modelo não encontrado.");

  const eligibleClientIds = await listMetricsEligibleClientIds();
  if (eligibleClientIds.size === 0) return { provisioned: 0, skipped: 0, errors: [] };

  const { data: clientsRes, error: clientsError } = await admin
    .from("clients")
    .select("id,slug,is_active")
    .in("id", Array.from(eligibleClientIds));
  if (clientsError) throw clientsError;
  const clients = (clientsRes ?? []).filter((c) => (c as { is_active: boolean }).is_active) as { id: string; slug: string }[];

  const summary: ProvisionSummary = { provisioned: 0, skipped: 0, errors: [] };
  for (const client of clients) {
    if (client.id === template.client_id) {
      summary.skipped += 1;
      continue;
    }
    try {
      if (template.kind === "plano_acao") {
        await clonePlan(admin, template, client.id);
      } else {
        const comment = await metricsSummaryComment(admin, client.id);
        await cloneSimpleTask(admin, template, client.id, comment);
      }
      summary.provisioned += 1;
    } catch (error) {
      summary.errors.push({ clientSlug: client.slug, message: errorMessage(error) });
    }
  }
  return summary;
}
