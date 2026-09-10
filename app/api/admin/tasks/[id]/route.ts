import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteTask, getClient, getClientFlowFlags, getTaskById, promoteTaskToFlowDelivery, setTaskAssigneeProfiles, setTaskPlanLink, updateTaskGroup, updateTaskPayloadPatch } from "@/lib/supabase";
import { EXPLICIT_DATES_KEY, inferDateGroupRule, normalizeOccurrenceDates } from "@/lib/taskDateGrouping";
import { recurrenceWeekdays } from "@/lib/recurrence";
import { isFlowDelivery, recurrenceParentIdOf } from "@/lib/taskRelations";
import { requireAdmin } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { justCompleted, nextFlowStepCardOf } from "@/lib/flows/advance";
import { flowDemotionProblem } from "@/lib/flows/demotion";
import { flowStepKeyOf } from "@/lib/taskRelations";
import { findType, listTaskTypes, type TaskBehavior } from "@/lib/taskTypes";
import { notifyProfiles, notifyTaskParticipants } from "@/lib/notifications";
import { notifiableChange } from "@/lib/notifiableChange";
import { HttpError, taskPatchSchema, type TaskRecord } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mesmo cálculo do POST (app/api/admin/tasks/route.ts) — cada rota resolve o
// próprio vocabulário porque o `behavior` do tipo é o que decide o que um
// PATCH de `kind` faz, exatamente como decide o que um POST cria.
async function taskBehaviorOf(kind: string): Promise<TaskBehavior> {
  const supabase = await createClient();
  return findType(await listTaskTypes(supabase), kind)?.behavior ?? "simples";
}

// GET /api/admin/tasks/[id] — single task, for surfaces (e.g. Plano de Ação's
// strategic view) that only hold a summary shape and need the full record to
// open the editor modal.
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const task = await getTaskById(id);
    if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
    return NextResponse.json(task);
  } catch (error) {
    return apiError(error);
  }
}

// O QUE merece virar notificação mora em lib/notifiableChange.ts, puro e
// testado. Aqui só resta despachar.
//
// Antes, este trecho era `if (status mudou) status; else "foi editado"`, sem
// olhar mais nada — e como `patchWithTopPosition` mexe no `position` em quase
// todo PATCH, e arrastar um card manda um PATCH por card RENUMERADO, a caixa de
// entrada de todo mundo virava um fluxo de "foi editado" de cards que ninguém
// tinha tocado. Agora um salvamento sem mudança significativa não avisa nada.
async function notifyTaskChange(before: TaskRecord, after: TaskRecord): Promise<void> {
  const { fanout, direct } = notifiableChange(before, after);
  if (fanout) await notifyTaskParticipants(after.id, fanout.type, fanout.message);
  // Quem ACABOU de entrar no card não está no leque — por definição, já que o
  // leque é derivado do card. Mudar o status e atribuir alguém no mesmo
  // salvamento são dois fatos para duas plateias.
  for (const alvo of direct) {
    await notifyProfiles([alvo.profileId], after.id, "task_assigned", alvo.message);
  }
}

// Concluir uma etapa cria a próxima dentro deste mesmo request. Devolvê-la
// junto é o que permite a interface oferecer o acesso na hora, em vez de deixar
// a pessoa fechar e reabrir o card para descobrir que o trabalho seguinte já
// existe. Campo extra no JSON, fora do TaskRecord — nenhum leitor atual quebra.
async function withFlowNextTask(before: TaskRecord, after: TaskRecord): Promise<TaskRecord & { flow_next_task?: TaskRecord }> {
  if (!justCompleted(before, after) || !flowStepKeyOf(after)) return after;
  try {
    const next = await nextFlowStepCardOf(createAdminClient(), after);
    return next ? { ...after, flow_next_task: next } : after;
  } catch {
    // A cascata em si já aconteceu; não conseguir ANUNCIAR a próxima etapa é
    // cosmético e não pode transformar um salvamento bem-sucedido em erro.
    return after;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const { slug, assignee_profile_ids, payload_patch, ...patch } = taskPatchSchema.parse(await request.json());

    const current = await getTaskById(id);
    if (!current) throw new HttpError(404, "Tarefa nao encontrada.");
    const explicitDates = normalizeOccurrenceDates(patch.payload?.[EXPLICIT_DATES_KEY]);
    if (!current.recurrence_cadence && !recurrenceParentIdOf(current) && explicitDates.length > 1) {
      const rule = inferDateGroupRule(explicitDates);
      patch.due_date = explicitDates[0];
      patch.start_date = explicitDates[0];
      patch.recurrence_cadence = rule.cadence;
      patch.recurrence_weekdays = rule.weekdays;
      patch.recurrence_day_of_month = rule.dayOfMonth;
      patch.end_date = explicitDates.at(-1);
      if (patch.payload) delete patch.payload[EXPLICIT_DATES_KEY];
    }

    // Resolve a client change before anything else — later checks (flow
    // flags) must see the DESTINATION client, not the one being left.
    let nextClientId = current.client_id;
    if (slug !== undefined) {
      const client = slug ? await getClient(slug, true) : null;
      if (slug && !client) throw new HttpError(404, "Cliente nao encontrado.");
      nextClientId = client?.id ?? null;
      (patch as Record<string, unknown>).client_id = nextClientId;
    }

    const nextRecurrence = patch.recurrence_cadence !== undefined ? patch.recurrence_cadence : current.recurrence_cadence;
    if (nextRecurrence) {
      const start = patch.start_date !== undefined ? patch.start_date : current.start_date ?? current.due_date;
      const weekdays = patch.recurrence_weekdays ?? current.recurrence_weekdays;
      if (!start) throw new HttpError(400, "Informe o início da recorrência.");
      // Dia-da-semana opcional: sem marcação, fica no dia da data de início.
      patch.recurrence_weekdays = recurrenceWeekdays(weekdays, start);
      patch.start_date = start;
      patch.recurrence_day_of_month = nextRecurrence === "mensal" ? Number(start.slice(8, 10)) : null;
      const end = patch.end_date !== undefined ? patch.end_date : current.end_date;
      if (!end || end < start) patch.end_date = start;
    }

    // Defense-in-depth: a client with a stage admin-disabled never carries a
    // reviewer/approver, even if a stale client tab (open before the flag
    // flipped) tries to send one back. Unassigned ("Outros") tasks have no
    // client flags to check.
    if (nextClientId) {
      const flags = await getClientFlowFlags(nextClientId);
      if (!flags.revisaoAdmin) {
        patch.reviewer_id = null;
        patch.requires_review = false;
      }
      if (!flags.aprovacaoAdmin) {
        patch.approver_id = null;
        patch.requires_approval = false;
      }
    }

    // Promoção "tipo comum → Entrega" (P0-B). O POST já faz o equivalente na
    // CRIAÇÃO (createFlowDelivery); o PATCH não tinha nada parecido, e trocar
    // o Tipo de uma atividade de plano para uma Entrega deixava o card com
    // `kind=criativo` e mais nada — confirmado em produção (card `04331233`,
    // pelado: sem flow_parent, sem peso congelado, sem etapa). `baseTask` é o
    // que `updateTaskGroup` abaixo vê como "current": depois da promoção ele
    // já reflete o status/payload novos, senão o resto deste mesmo patch
    // rotearia contra o card pré-promoção.
    let baseTask = current;
    if (typeof patch.kind === "string" && patch.kind !== current.kind) {
      const nextBehavior = await taskBehaviorOf(patch.kind);
      if (nextBehavior === "entrega" && !isFlowDelivery(current)) {
        baseTask = await promoteTaskToFlowDelivery(id, current, patch.kind);
        // A promoção já decidiu kind/subtype/status (ver
        // promoteTaskToFlowDelivery) — não deixar o patch original
        // sobrescrevê-los de volta (ex.: o subtype/status que a atividade
        // comum já tinha antes da troca de Tipo).
        delete (patch as Record<string, unknown>).kind;
        delete (patch as Record<string, unknown>).subtype;
        delete (patch as Record<string, unknown>).status;
      } else if (nextBehavior !== "entrega" && isFlowDelivery(current)) {
        // Caminho inverso (Entrega → tipo comum): recusa com erro claro em vez
        // de deixar a corrente de etapas órfã. Ver lib/flows/demotion.ts.
        const problem = flowDemotionProblem(current);
        if (problem) throw new HttpError(400, problem);
      }
    }

    // "Plano de Ação" continua sendo um campo único no card, mas agora ele
    // escreve um ELO, não uma coluna: `plan_id` passou a significar só
    // "ocorrência de recorrência". setTaskPlanLink mexe apenas no elo sem
    // slot, para não derrubar as ligações de etapa de uma corrente.
    const { plan_id: planLink, ...taskPatch } = patch as Record<string, unknown>;
    let task = await updateTaskGroup(id, baseTask, taskPatch, session.userId);
    if (planLink !== undefined) {
      await setTaskPlanLink(id, typeof planLink === "string" && planLink ? planLink : null);
    }
    if (payload_patch) task = await updateTaskPayloadPatch(id, payload_patch);
    if (assignee_profile_ids !== undefined) await setTaskAssigneeProfiles(task.id, assignee_profile_ids);

    // Reler pelo caminho completo antes de responder. As escritas devolvem só
    // as colunas de `tasks`, sem os joins — então a resposta saía sem `parents`
    // (e sem os responsáveis vinculados). Como o cliente FUNDE essa resposta no
    // estado local, uma resposta incompleta apagava os elos que a tela acabara
    // de aprender: a caixa de etapas voltava a mostrar o slot vazio.
    const saved = (await getTaskById(task.id)) ?? task;
    await notifyTaskChange(current, saved);
    return NextResponse.json(await withFlowNextTask(current, saved));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
