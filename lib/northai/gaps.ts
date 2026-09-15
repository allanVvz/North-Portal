// "O que falta amarrar" — as lacunas de um cliente, lidas dos dados que já
// existem, cada uma com a receita que resolve. Puro: quem chama carrega os dados.

import { deadlineStateOf } from "@/app/admin/deadlineState";
import { CLIENT_STANDARD_ROUTINES } from "@/lib/clientRoutines";
import { belongsToTaskScreen, isFlowDelivery } from "@/lib/taskRelations";
import type { TaskRecord } from "@/lib/validation";
import type { RecipeKey } from "./commandParser";
import { normalizeText } from "./formats";

export type GapInput = {
  tasks: TaskRecord[];
  automations: { automationKey: string; active: boolean; targetTaskId: string }[];
  hasContract: boolean;
  briefingSubmitted: boolean;
  gedReady: boolean;
  today: string;
};

export type Gap = {
  key: string;
  severity: "alta" | "media" | "baixa";
  title: string;
  detail: string;
  recipe: RecipeKey | null;
  prefill?: Record<string, unknown>;
  taskIds?: string[];
};

export type ReadinessCheck = { key: string; label: string; ok: boolean };

export type ClientInsight = {
  gaps: Gap[];
  readiness: { percent: number; checks: ReadinessCheck[] };
  numbers: { atrasadas: number; paradas: number; semana: number; emAndamento: number };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function clientInsight(input: GapInput): ClientInsight {
  const open = input.tasks.filter((task) => task.status !== "aprovado");
  const board = open.filter((task) => belongsToTaskScreen(task));
  const titles = new Set(input.tasks.map((task) => normalizeText(task.title).trim()));
  const missingRoutines = CLIENT_STANDARD_ROUTINES.filter((routine) => !titles.has(normalizeText(routine.title).trim()));
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const activeAutomations = input.automations.filter((automation) => automation.active && taskIds.has(automation.targetTaskId));
  const activePlan = open.some((task) => task.kind === "plano_acao");

  const late = board.filter((task) => deadlineStateOf(task, input.today) === "atrasada");
  const stopped = open.filter((task) => task.status === "parada");
  const noAssignee = board.filter((task) => !task.assignee?.trim() && !(task.assignee_profile_ids ?? []).length);
  const noDate = board.filter((task) => !task.due_date && !task.recurrence_cadence);
  const deliveriesNoFormat = open.filter((task) => isFlowDelivery(task) && !(task.payload as Record<string, unknown> | null)?.formato);
  const weekEnd = addDays(input.today, 7);
  const week = board.filter((task) => task.due_date && task.due_date >= input.today && task.due_date <= weekEnd);

  const gaps: Gap[] = [];
  if (stopped.length) {
    gaps.push({ key: "paradas", severity: "alta", title: plural(stopped.length, "card parado", "cards parados"), detail: "Destrave antes de criar mais trabalho.", recipe: null, taskIds: stopped.map((task) => task.id) });
  }
  if (late.length) {
    gaps.push({ key: "atrasadas", severity: "alta", title: plural(late.length, "tarefa atrasada", "tarefas atrasadas"), detail: "Remarque ou conclua pela lista de etapas.", recipe: null, taskIds: late.map((task) => task.id) });
  }
  if (missingRoutines.length) {
    const first = missingRoutines[0];
    gaps.push({
      key: "rotinas",
      severity: "media",
      title: `Faltam ${plural(missingRoutines.length, "rotina padrão", "rotinas padrão")}`,
      detail: missingRoutines.map((routine) => routine.title).join(", "),
      recipe: "rotina",
      prefill: { title: first.title, description: first.description, cadence: first.cadence },
    });
  }
  if (noAssignee.length) {
    gaps.push({ key: "sem-responsavel", severity: "media", title: plural(noAssignee.length, "card sem responsável", "cards sem responsável"), detail: "Ninguém é avisado sobre eles.", recipe: null, taskIds: noAssignee.map((task) => task.id) });
  }
  if (noDate.length) {
    gaps.push({ key: "sem-data", severity: "baixa", title: plural(noDate.length, "card sem data", "cards sem data"), detail: "Não entram no calendário nem no atraso.", recipe: null, taskIds: noDate.map((task) => task.id) });
  }
  if (deliveriesNoFormat.length) {
    gaps.push({ key: "sem-formato", severity: "baixa", title: plural(deliveriesNoFormat.length, "entrega sem formato", "entregas sem formato"), detail: "Defina Reels, carrossel, banner ou story no card.", recipe: null, taskIds: deliveriesNoFormat.map((task) => task.id) });
  }
  if (!activeAutomations.length) {
    gaps.push({ key: "sem-automacao", severity: "media", title: "Nenhuma automação ativa", detail: "O relatório semanal de anúncios ainda não roda para este cliente.", recipe: "automacao", prefill: { automationKey: "relatorio_trafego_semanal" } });
  }
  if (!activePlan) {
    gaps.push({ key: "sem-plano", severity: "baixa", title: "Nenhum plano de ação aberto", detail: "O plano dos primeiros 60 dias organiza o ciclo.", recipe: "plano" });
  }
  if (!input.gedReady) {
    gaps.push({ key: "ged", severity: "baixa", title: "GED do cliente sem pastas", detail: "Os arquivos importados ainda não têm pasta no Drive da plataforma.", recipe: null });
  }

  const checks: ReadinessCheck[] = [
    { key: "contrato", label: "Contrato e escopo", ok: input.hasContract },
    { key: "briefing", label: "Briefing respondido", ok: input.briefingSubmitted },
    { key: "rotinas", label: "Rotinas padrão", ok: missingRoutines.length === 0 },
    { key: "responsaveis", label: "Cards com responsável", ok: noAssignee.length === 0 },
    { key: "automacao", label: "Automação ativa", ok: activeAutomations.length > 0 },
    { key: "ged", label: "GED", ok: input.gedReady },
  ];

  return {
    gaps,
    readiness: { percent: Math.round((checks.filter((check) => check.ok).length / checks.length) * 100), checks },
    numbers: { atrasadas: late.length, paradas: stopped.length, semana: week.length, emAndamento: board.length },
  };
}
