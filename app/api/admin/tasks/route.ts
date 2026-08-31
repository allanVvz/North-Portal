import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { notifyTaskParticipants, taskCreatedMessage } from "@/lib/notifications";
import {
  createFlowDelivery,
  createRecurringFlowDelivery,
  createRecurringTaskGroup,
  createTask,
  linkTasks,
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
import { recurrenceWeekdays } from "@/lib/recurrence";
import { recurrenceParentPayload } from "@/lib/recurrenceState";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, taskCreateSchema, validateSlug } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { findType, listTaskTypes, type TaskBehavior } from "@/lib/taskTypes";

async function taskBehaviorOf(kind: string): Promise<TaskBehavior> {
  const supabase = await createClient();
  return findType(await listTaskTypes(supabase), kind)?.behavior ?? "simples";
}

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
    if (scope && !["task", "plan", "routine", "flow-step"].includes(scope)) throw new HttpError(400, "Contexto de criacao invalido.");
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

    // Uma porta só: o TIPO escolhido decide o que nasce, não o botão que a
    // pessoa clicou. Um tipo com behavior 'entrega' vira uma corrente de
    // etapas; 'plano' vira um agregador; o resto vira um card comum.
    //
    // A exceção: `scope=flow-step` diz "crie SÓ o card daquela etapa, não a
    // corrente". Vem de escolher um subtipo específico de uma Entrega no modal
    // (em vez de "Fluxo completo"). O card nasce solto — sem entrega-pai — e é
    // inofensivo: `chainDelivery` fica nulo, `reconcileFlows` acha zero pais.
    // Pode ser ligado a uma entrega depois pelo botão de corrente.
    const behavior = await taskBehaviorOf(fields.kind ?? "operacional");
    const flowStepOnly = scope === "flow-step";
    if (flowStepOnly && behavior !== "entrega") throw new HttpError(400, "Etapa de fluxo exige um tipo de entrega.");
    if (flowStepOnly && !fields.subtype) throw new HttpError(400, "Escolha a etapa do fluxo.");
    if (scope === "plan") {
      fields.kind = "plano_acao";
    } else if (scope === "routine") {
      if (!fields.recurrence_cadence) throw new HttpError(400, "Uma Rotina precisa ter recorrencia.");
      // "Rotina" é só o rótulo sintético de uma Tarefa recorrente; uma Entrega
      // recorrente existe, mas nasce pelo tipo Entrega + o toggle, não por aqui.
      if (behavior === "entrega") throw new HttpError(400, "Uma entrega nao pode ser uma rotina.");
    }

    if (fields.recurrence_cadence) {
      const start = fields.start_date ?? fields.due_date;
      if (!start) throw new HttpError(400, "Informe o início da recorrência.");
      // Dia-da-semana é opcional: sem marcação, a recorrência fica no dia da
      // data de início (ver recurrenceWeekdays). Nunca guardamos lista vazia.
      fields.recurrence_weekdays = recurrenceWeekdays(fields.recurrence_weekdays, start);
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

    // plan_id é elo, não coluna: sai dos campos do insert e vira uma ligação
    // depois que o card existe.
    const { plan_id: planLink, ...taskFields } = fields;
    // Entrega recorrente: o molde carrega as marcas de fluxo E a recorrência, e
    // cada ciclo materializa uma entrega-ocorrência própria (com sua primeira
    // etapa) — o rollup de progresso lê a ocorrência, nunca o molde, então não
    // há "pai de pai".
    const flow = behavior === "entrega" && !flowStepOnly
      ? fields.recurrence_cadence
        ? await createRecurringFlowDelivery(client?.id ?? null, taskFields, fields.kind!, fields.subtype)
        : await createFlowDelivery(client?.id ?? null, taskFields, fields.kind!, fields.subtype)
      : null;
    // A resposta continua sendo o PASSO — é o card que a pessoa vai abrir, já
    // que a entrega não aparece no quadro.
    const task = flow
      ? flow.step
      : fields.recurrence_cadence && scope !== "routine"
        ? await createRecurringTaskGroup(client?.id ?? null, taskFields)
        : await createTask(client?.id ?? null, taskFields);
    // Mas quem entra no Plano de Ação é a ENTREGA, não o primeiro passo dela.
    // Ligar o passo, como se fazia, punha um pedaço da corrente no plano e
    // deixava a peça inteira de fora.
    if (planLink) await linkTasks(planLink, flow ? flow.delivery.id : task.id);
    if (assignee_profile_ids?.length) {
      await setTaskAssigneeProfiles(task.id, assignee_profile_ids);
      // O pai precisa dos mesmos responsáveis, porque é o card que a pessoa
      // realmente procurou. Numa recorrência ele vem por `plan_id`; numa
      // entrega, `flowStepFields` grava `plan_id: null` de propósito, então
      // sem o ramo explícito abaixo a entrega NUNCA recebia responsável.
      if (flow) await setTaskAssigneeProfiles(flow.delivery.id, assignee_profile_ids);
      // Entrega recorrente: além da ocorrência 0 (flow.delivery), o molde
      // também — é ele que reaparece a cada ciclo. `flow.delivery.plan_id` é o
      // molde; para a entrega não-recorrente é null e o ramo não dispara.
      if (flow?.delivery.plan_id) await setTaskAssigneeProfiles(flow.delivery.plan_id, assignee_profile_ids);
      else if (task.plan_id && task.plan_id !== task.id) await setTaskAssigneeProfiles(task.plan_id, assignee_profile_ids);
    }
    // Ser entregue um card é a coisa mais importante a saber sobre ele, e até
    // agora a criação era o único evento totalmente mudo — inclusive a etapa
    // que a cascata cria, que já nasce com responsável e revisor herdados.
    // Cai na mesma regra `updates`: nascer é uma atualização para quem
    // acompanha.
    await notifyTaskParticipants(task.id, "task_created", taskCreatedMessage(task.title));
    const full = await getTaskById(task.id);
    return NextResponse.json(full ?? task, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
