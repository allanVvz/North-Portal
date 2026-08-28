import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import {
  createFlowDelivery,
  createRecurringTaskGroup,
  createTask,
  getClient,
  getClientFlowFlags,
  getTaskById,
  listAllTasks,
  listRelatedTasks,
  listTasks,
  listUnassignedTasks,
  setTaskAssigneeProfiles,
} from "@/lib/supabase";
import { EXPLICIT_DATES_KEY, inferDateGroupRule, normalizeOccurrenceDates } from "@/lib/taskDateGrouping";
import { recurrenceParentPayload } from "@/lib/recurrenceState";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema, validateSlug } from "@/lib/validation";

// GET /api/admin/tasks?slug=<client>  → all tasks for a client's board
// GET /api/admin/tasks?unassigned=1   → tasks with no client ("Outros" filter)
// GET /api/admin/tasks (neither)      → cross-client feed, for the "Todos" filter
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const rawSlug = url.searchParams.get("slug") ?? "";
    const parentId = url.searchParams.get("parentId");
    if (parentId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId)) {
        throw new HttpError(400, "ID do card pai invalido.");
      }
      return NextResponse.json({ tasks: await listRelatedTasks(parentId) });
    }
    if (url.searchParams.get("unassigned") === "1") {
      return NextResponse.json({ tasks: await listUnassignedTasks() });
    }
    if (!rawSlug) {
      return NextResponse.json({ tasks: await listAllTasks() });
    }
    const slug = validateSlug(rawSlug);
    const client = await getClient(slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    return NextResponse.json({ tasks: await listTasks(client.id) });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/tasks  → create a task, optionally on a client's board.
// Omitting slug creates an unassigned ("Outros") task.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope && !["task", "plan", "routine", "flow"].includes(scope)) throw new HttpError(400, "Contexto de criacao invalido.");
    const body = taskCreateSchema.parse(await request.json());
    const client = body.slug ? await getClient(body.slug, true) : null;
    if (body.slug && !client) throw new HttpError(404, "Cliente nao encontrado.");
    const { slug: _slug, assignee_profile_ids, ...fields } = body;
    void _slug;
    const explicitDates = normalizeOccurrenceDates(fields.payload?.[EXPLICIT_DATES_KEY], fields.due_date);
    const createsDateGroup = explicitDates.length > 1;
    if (createsDateGroup) {
      const rule = inferDateGroupRule(explicitDates);
      fields.due_date = explicitDates[0];
      fields.start_date = explicitDates[0];
      fields.end_date = explicitDates.at(-1);
      fields.recurrence_cadence = rule.cadence;
      fields.recurrence_weekdays = rule.weekdays;
      fields.recurrence_day_of_month = rule.dayOfMonth;
      if (fields.payload) delete fields.payload[EXPLICIT_DATES_KEY];
    }

    if (scope === "plan") {
      fields.kind = "plano_acao";
    } else if (scope === "task") {
      if (fields.kind === "plano_acao") throw new HttpError(400, "A tela Tarefas nao cria Planos de Acao.");
    } else if (scope === "routine") {
      if (!fields.recurrence_cadence) throw new HttpError(400, "Uma Rotina precisa ter recorrencia.");
    } else if (scope === "flow") {
      if (!fields.flow_template_id) throw new HttpError(400, "Escolha um fluxo para a entrega.");
      // A entrega não é um card de trabalho: ela agrega etapas. Recorrência
      // sobre ela geraria um pai de pai, que nenhum rollup sabe ler.
      if (fields.recurrence_cadence) throw new HttpError(400, "Uma entrega de fluxo nao pode ser recorrente.");
    }
    // flow_template_id só entra por scope=flow: qualquer outro caminho que o
    // aceitasse criaria um card que agrega etapas sem nunca ter uma.
    if (scope !== "flow") fields.flow_template_id = null;

    if (fields.status === "concluido" && (fields.kind ?? "criativo") !== "criativo") {
      throw new HttpError(400, "Apenas cards do tipo Criativo podem ir para Publicado.");
    }
    if (fields.recurrence_cadence) {
      const start = fields.start_date ?? fields.due_date;
      if (!start) throw new HttpError(400, "Informe o início da recorrência.");
      if (!fields.recurrence_weekdays?.length) throw new HttpError(400, "Selecione pelo menos um dia da semana.");
      fields.start_date = start;
      fields.due_date = start;
      fields.end_date = fields.end_date && fields.end_date >= start ? fields.end_date : start;
      fields.recurrence_day_of_month = fields.recurrence_cadence === "mensal" ? Number(start.slice(8, 10)) : null;
      fields.payload = recurrenceParentPayload(fields.payload);
      delete fields.payload[EXPLICIT_DATES_KEY];
    }

    // Defense-in-depth: never create a task with a reviewer/approver for a
    // client whose stage is admin-disabled. Unassigned tasks have no flags
    // to check — the fields pass through as given.
    if (client) {
      const flags = await getClientFlowFlags(client.id);
      if (!flags.revisaoAdmin) { fields.reviewer_id = null; fields.requires_review = false; }
      if (!flags.aprovacaoAdmin) { fields.approver_id = null; fields.requires_approval = false; }
    }

    const { flow_template_id: flowTemplateId, ...taskFields } = fields;
    const task = scope === "flow"
      ? await createFlowDelivery(client?.id ?? null, taskFields, flowTemplateId!)
      : fields.recurrence_cadence && scope !== "routine"
        ? await createRecurringTaskGroup(client?.id ?? null, fields)
        : await createTask(client?.id ?? null, fields);
    if (assignee_profile_ids?.length) {
      await setTaskAssigneeProfiles(task.id, assignee_profile_ids);
      // A recurring group's returned row is the first execution, and a flow's
      // is the first step; in both cases the parent needs the same linked
      // accounts, since it is the card the person actually searched for.
      if (task.plan_id && task.plan_id !== task.id) await setTaskAssigneeProfiles(task.plan_id, assignee_profile_ids);
    }
    const full = await getTaskById(task.id);
    return NextResponse.json(full ?? task, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
