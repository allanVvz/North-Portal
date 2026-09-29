import { classifyTask } from "@/lib/taskClassification";
import { childrenByParent, flowStepsOf, isDeferredTask, isFlowDelivery, parentIdsOf, recurrenceParentIdOf, visibleOnTaskBoard } from "@/lib/taskRelations";
import { isRecurrenceTemplate } from "@/lib/recurrenceState";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import type { RecurringTask } from "@/lib/supabase";
import type { TaskRecord, TaskStatus } from "@/lib/validation";
import { deadlineStateOf } from "../deadlineState";
import { recurringState } from "../recurringState";

export type OperationTask = TaskRecord & { clientName?: string; clientSlug?: string };

/** Nível de importância de um card na Operação: rotina > plano > entrega >
 *  tarefa. Um trabalho aparece UMA vez, pelo nível mais alto a que pertence. */
export type OperationLevel = "rotina" | "plano" | "entrega" | "tarefa";

export type OperationItem = {
  id: string;
  task: OperationTask | RecurringTask;
  clientName: string;
  clientSlug: string;
  routine: boolean;
  level: OperationLevel;
  /** O que o card representa: execuções da rotina, membros do plano, etapas
   *  da entrega. Vazio numa tarefa. */
  members: TaskRecord[];
};

export type OperationFilterAttr = "status" | "tipo" | "subtipo" | "situacao" | "cliente" | "frequencia" | "prioridade" | "responsavel";
export type OperationFilter = { attr: OperationFilterAttr; value: string; label: string };

/** Atributos que aceitam vários valores ao mesmo tempo. Status soma (OU —
 * "Entrada ou Revisão"); Tipo intersecta (E — "Rotina e Automação"). Os
 * demais trocam o valor anterior. */
export const MULTI_VALUE_ATTRS: readonly OperationFilterAttr[] = ["status", "tipo"];

/** A tela abre mostrando só o que ainda está vivo: tudo menos Concluído. Era
 * a regra implícita do quadro antigo ("concluídas ficam ocultas"), agora
 * explícita e removível como qualquer outro filtro. */
export const DEFAULT_OPERATION_FILTERS: readonly OperationFilter[] = [
  { attr: "status", value: "backlog", label: "Entrada" },
  { attr: "status", value: "em_producao", label: "Em produção" },
  { attr: "status", value: "revisao", label: "Revisão" },
  { attr: "status", value: "aprovacao", label: "Aprovação" },
  { attr: "status", value: "parada", label: "Parada" },
];

const isPlan = (task: Pick<TaskRecord, "kind">) => task.kind === "plano_acao";

/**
 * A Operação mostra cada trabalho UMA vez, pelo nível mais importante a que ele
 * pertence: rotina > plano > entrega > tarefa (28/09/2026).
 *
 * Antes a mesma coisa aparecia várias vezes. O relatório semanal de um cliente
 * surgia como rotina (o molde), como três etapas soltas em Tarefas e ainda como
 * Entrega na outra aba; um membro de plano aparecia solto e dentro do plano.
 * Agora:
 *   - rotina: sempre aparece; suas execuções (e tudo abaixo delas) somem;
 *   - plano: aparece se não pertence a uma rotina; seus membros somem;
 *   - entrega: aparece se não pertence a rotina nem a plano; suas etapas somem;
 *   - tarefa: aparece só quando não tem pai nenhum.
 * Um pai que não veio na lista (outro cliente, oculto) não esconde o filho:
 * esconder por um pai invisível faria o trabalho sumir da tela.
 */
export function normalizeOperationItems(tasks: readonly OperationTask[], routines: readonly RecurringTask[]): OperationItem[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const routineIds = new Set(routines.map((routine) => routine.id));
  const executionIds = new Set(routines.flatMap((routine) => routine.executions.map((execution) => execution.id)));
  const children = childrenByParent(tasks);
  for (const task of tasks) {
    // Membro de plano legado: só `plan_id`, sem elo.
    if (!task.plan_id || parentIdsOf(task).includes(task.plan_id)) continue;
    children.set(task.plan_id, [...(children.get(task.plan_id) ?? []), task]);
  }

  const parentsOf = (task: TaskRecord): string[] => {
    const ids = [...parentIdsOf(task)];
    if (task.plan_id) ids.push(task.plan_id);
    const recurrenceParent = recurrenceParentIdOf(task);
    if (recurrenceParent) ids.push(recurrenceParent);
    return ids;
  };
  /** Algum ancestor visível representa este card? */
  const represented = (task: TaskRecord, seen = new Set<string>()): boolean => {
    if (executionIds.has(task.id)) return true;
    for (const parentId of parentsOf(task)) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      if (routineIds.has(parentId)) return true;
      const parent = byId.get(parentId);
      if (!parent) continue;
      if (isPlan(parent) || isFlowDelivery(parent)) return true;
      if (represented(parent, seen)) return true;
    }
    return false;
  };

  const output: OperationItem[] = [];
  const seen = new Set<string>();
  const push = (item: OperationItem) => { if (!seen.has(item.id)) { seen.add(item.id); output.push(item); } };

  for (const task of tasks) {
    if (!visibleOnTaskBoard(task) || isRecurrenceTemplate(task) || routineIds.has(task.id) || represented(task)) continue;
    const level: OperationLevel = isPlan(task) ? "plano" : isFlowDelivery(task) ? "entrega" : "tarefa";
    const members = level === "entrega" ? flowStepsOf(task.id, tasks) : level === "plano" ? children.get(task.id) ?? [] : [];
    push({ id: task.id, task, clientName: task.clientName ?? "Outros", clientSlug: task.clientSlug ?? "", routine: false, level, members });
  }
  for (const routine of routines) {
    // Molde de anúncios de uma automação de relatório: a rotina da Entrega o
    // representa (lib/automations/routineFeeds.ts).
    const representedBy = (routine as { represented_by?: string | null }).represented_by;
    if (representedBy && routineIds.has(representedBy)) continue;
    push({ id: routine.id, task: routine, clientName: routine.clientName, clientSlug: routine.clientSlug, routine: true, level: "rotina", members: routine.executions });
  }
  return output;
}

/** Plano ou entrega vindo da aba Planos e Entregas (já hidratado com os filhos). */
export function parentOperationItem(card: TaskRecord & { clientName: string; clientSlug: string; activities: TaskRecord[] }): OperationItem {
  return {
    id: card.id, task: card, clientName: card.clientName, clientSlug: card.clientSlug, routine: false,
    level: isPlan(card) ? "plano" : "entrega", members: card.activities,
  };
}

/**
 * O status que a Operação usa para filtrar e agrupar — o do TRABALHO, não o
 * carimbo do card:
 *   - tarefa: o próprio status;
 *   - entrega: a etapa corrente (o card pai só guarda o último carimbo da cascata);
 *   - plano: aprovado só quando concluído;
 *   - rotina: aprovada só quando ENCERRADA (molde aprovado). Antes valia o status
 *     projetado da última execução: aprovar a execução da semana tirava da tela
 *     uma rotina ativa, com próximo ciclo marcado. Sem execução aberta, a rotina
 *     está esperando o próximo ciclo — Entrada.
 */
export function operationStatusOf(item: OperationItem): TaskStatus {
  const task = item.task;
  if (item.level === "tarefa") return task.status;
  if (item.level === "entrega") {
    if (task.completed_at) return "aprovado";
    return currentFlowStepOf(item.members)?.status ?? task.status;
  }
  if (item.level === "plano") {
    if (task.completed_at) return "aprovado";
    return task.status === "aprovado" ? "em_producao" : task.status;
  }
  const template = (task as RecurringTask).template_status ?? task.status;
  if (template === "aprovado") return "aprovado";
  if (template === "parada") return "parada";
  const open = item.members.filter((execution) => !execution.completed_at && execution.status !== "aprovado" && !isDeferredTask(execution));
  const current = [...open].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).at(-1);
  return current?.status ?? "backlog";
}

export function itemTypeTags(item: OperationItem): string[] {
  const base = classifyTask(item.task.kind, item.task.subtype).baseType;
  const tags = new Set<string>([base]);
  if (item.level !== "tarefa") tags.add(item.level);
  return [...tags];
}

const LEVEL_LABEL: Record<OperationLevel, string> = { rotina: "Rotina", plano: "Plano", entrega: "Entrega", tarefa: "Tarefa" };

export function itemTypeLabels(item: OperationItem): string[] {
  return [...new Set([classifyTask(item.task.kind, item.task.subtype).baseLabel, ...(item.level !== "tarefa" ? [LEVEL_LABEL[item.level]] : [])])];
}

export function levelLabel(level: OperationLevel): string { return LEVEL_LABEL[level]; }

export function compatibleSubtypes(items: readonly OperationItem[], selectedTypes: readonly string[]): string[] {
  return [...new Set(items
    .filter((item) => selectedTypes.every((tag) => itemTypeTags(item).includes(tag)))
    .map((item) => classifyTask(item.task.kind, item.task.subtype).subtypeKey)
    .filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function assignees(item: OperationItem): string[] {
  return (item.task.assignee ?? "").split(",").map((name) => name.trim()).filter(Boolean);
}

export function operationSituation(item: OperationItem, today: string): string {
  if (item.routine) {
    const routine = item.task as RecurringTask;
    return recurringState(routine, today);
  }
  if (item.task.completed_at) return "concluida";
  // Entrega: a situação é a da etapa corrente. Plano: parada/atrasada se algum
  // membro aberto estiver assim. Mesma regra do acordeão de Planos e Entregas.
  if (item.level === "entrega") {
    const current = currentFlowStepOf(item.members);
    if (current) return deadlineStateOf(current, today);
  }
  if (item.level === "plano") {
    const states = item.members.filter((member) => !member.completed_at).map((member) => deadlineStateOf(member, today));
    if (states.includes("parada")) return "parada";
    if (states.includes("atrasada")) return "atrasada";
  }
  return deadlineStateOf(item.task, today);
}

/** Different attributes AND together. Multiple Tipo chips also AND together,
 * which is what makes `Rotina` + `Automação` a precise intersection. Multiple
 * Status chips OR together — a card has one status, so AND would be empty.
 * For a routine the status is its template's: an `aprovado` template is a
 * closed routine, hidden by the default filter like any finished card. */
export function operationMatchesFilters(item: OperationItem, filters: readonly OperationFilter[], today: string): boolean {
  const statuses = filters.filter((filter) => filter.attr === "status").map((filter) => filter.value);
  if (statuses.length && !statuses.includes(operationStatusOf(item))) return false;
  return filters.every((filter) => {
    if (filter.attr === "status") return true;
    if (filter.attr === "tipo") return itemTypeTags(item).includes(filter.value);
    if (filter.attr === "subtipo") return classifyTask(item.task.kind, item.task.subtype).subtypeKey === filter.value;
    if (filter.attr === "situacao") return operationSituation(item, today) === filter.value;
    if (filter.attr === "cliente") return item.clientName === filter.value;
    if (filter.attr === "frequencia") return item.routine && (item.task as RecurringTask).cadence === filter.value;
    if (filter.attr === "prioridade") return item.task.priority === filter.value;
    const names = assignees(item);
    return filter.value === "Sem responsável" ? names.length === 0 : names.includes(filter.value);
  });
}

export type RoutineCalendarEvent = { id: string; date: string; routine: RecurringTask; execution: TaskRecord };

/** Date precedence is factual: an explicit scheduled timestamp, then the
 * persisted occurrence date, finally the task due date. */
export function factualDateOf(task: Pick<TaskRecord, "scheduled_start_at" | "payload" | "due_date">): string | null {
  if (task.scheduled_start_at) {
    const parsed = new Date(task.scheduled_start_at);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
      const value = (type: string) => parts.find((part) => part.type === type)?.value;
      const year = value("year"); const month = value("month"); const day = value("day");
      if (year && month && day) return `${year}-${month}-${day}`;
    }
  }
  const occurrence = task.payload?.occurrence_date;
  if (typeof occurrence === "string" && /^\d{4}-\d{2}-\d{2}/.test(occurrence)) return occurrence.slice(0, 10);
  return task.due_date?.slice(0, 10) ?? null;
}

/**
 * There is deliberately no cadence expansion here. Completed executions are
 * historical facts; at most one open materialized execution represents now.
 */
export function factualRoutineEvents(routines: readonly RecurringTask[]): RoutineCalendarEvent[] {
  const events: RoutineCalendarEvent[] = [];
  for (const routine of routines) {
    // The API has already joined these child rows to their template. Legacy
    // explicit children do not always mirror that relation in payload. A
    // deferred row cannot become the present-tense occurrence.
    const materializedOpen = routine.executions.filter((execution) => !execution.completed_at && execution.status !== "aprovado" && execution.status !== "parada" && !isDeferredTask(execution));
    const current = [...materializedOpen].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.created_at.localeCompare(b.created_at)).at(-1) ?? null;
    const emitted = new Set<string>();
    for (const execution of routine.executions) {
      if (isDeferredTask(execution)) continue;
      const completed = Boolean(execution.completed_at) || execution.status === "aprovado";
      const isCurrent = current?.id === execution.id;
      if (!completed && (!isCurrent || isDeferredTask(execution))) continue;
      const date = factualDateOf(execution);
      if (date && !emitted.has(execution.id)) { emitted.add(execution.id); events.push({ id: `${routine.id}:${execution.id}`, date, routine, execution }); }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.routine.title.localeCompare(b.routine.title, "pt-BR"));
}
