// O que o NorthAi sabe da operação de um cliente e o que falta amarrar — lido
// dos dados que já existem, cada lacuna com a receita que resolve. Puro: quem
// chama carrega os dados (lib/northai/context.ts).
//
// Uma lacuna só é mostrada quando a consulta VIU a ausência. Se a leitura
// falhar, o caso de uso lança e a tela mostra erro de carregamento — nunca uma
// lista de lacunas inventadas por dado faltando.

import { deadlineStateOf } from "@/app/admin/deadlineState";
import { CLIENT_STANDARD_ROUTINES } from "@/lib/clientRoutines";
import { recurrenceStopped } from "@/lib/recurrenceState";
import { belongsToTaskScreen, isFlowDelivery } from "@/lib/taskRelations";
import { addDaysIso } from "@/lib/time/agency";
import type { TaskRecord } from "@/lib/validation";
import type { RecipeKey } from "./commandParser";
import { normalizeText } from "./formats";

export type GapInput = {
  /** TODOS os cards do cliente — planos, entregas e moldes de rotina incluídos. */
  tasks: TaskRecord[];
  automations: { automationKey: string; active: boolean; targetTaskId: string }[];
  hasContract: boolean;
  briefingSubmitted: boolean;
  /** Arquivos do cliente prontos (sempre no armazenamento interno; no Drive, com pastas criadas). */
  filesReady: boolean;
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

export type OperationToday = {
  abertas: number;
  atrasadas: number;
  paradas: number;
  semana: number;
  rotinasAtivas: number;
  automacoesAtivas: number;
  planoAtivo: { id: string; title: string } | null;
  proximaGravacao: { id: string; title: string; date: string } | null;
};

export type ClientInsight = {
  gaps: Gap[];
  readiness: { percent: number; checks: ReadinessCheck[] };
  operation: OperationToday;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * O card que cumpre uma rotina padrão. Pela chave estável `payload.routine_key`
 * (gravada no cadastro desde 16/09); cards anteriores a isso só são
 * reconhecidos pelo título exato do catálogo — um título editado ("Kickoff e
 * onboarding") não conta. Sem fuzzy de propósito: um palpite errado esconderia
 * uma rotina que falta de verdade.
 */
export function findStandardRoutine(tasks: readonly TaskRecord[], routine: { key: string; title: string }): TaskRecord | null {
  const byKey = tasks.find((task) => (task.payload as Record<string, unknown> | null)?.routine_key === routine.key);
  if (byKey) return byKey;
  const title = normalizeText(routine.title).trim();
  return tasks.find((task) => normalizeText(task.title).trim() === title) ?? null;
}

export function clientInsight(input: GapInput): ClientInsight {
  const open = input.tasks.filter((task) => task.status !== "aprovado");
  const board = open.filter((task) => belongsToTaskScreen(task));
  const missingRoutines = CLIENT_STANDARD_ROUTINES.filter((routine) => !findStandardRoutine(input.tasks, routine));
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const activeAutomations = input.automations.filter((automation) => automation.active && taskIds.has(automation.targetTaskId));
  const plans = open.filter((task) => task.kind === "plano_acao");
  const activeRoutines = input.tasks.filter((task) => task.recurrence_cadence && !recurrenceStopped(task.status));

  const late = board.filter((task) => deadlineStateOf(task, input.today) === "atrasada");
  const stopped = open.filter((task) => task.status === "parada");
  const noAssignee = board.filter((task) => !task.assignee?.trim() && !(task.assignee_profile_ids ?? []).length);
  const noDate = board.filter((task) => !task.due_date);
  const deliveriesNoFormat = open.filter((task) => isFlowDelivery(task) && !(task.payload as Record<string, unknown> | null)?.formato);
  const weekEnd = addDaysIso(input.today, 7);
  const week = board.filter((task) => task.due_date && task.due_date >= input.today && task.due_date <= weekEnd);
  const nextShoot = open
    .filter((task) => task.subtype === "captacao" && task.due_date && task.due_date >= input.today)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];

  const gaps: Gap[] = [];
  if (stopped.length) {
    gaps.push({ key: "paradas", severity: "alta", title: plural(stopped.length, "card parado", "cards parados"), detail: "Destrave antes de criar mais trabalho.", recipe: null, taskIds: stopped.map((task) => task.id) });
  }
  if (late.length) {
    gaps.push({ key: "atrasadas", severity: "alta", title: plural(late.length, "tarefa atrasada", "tarefas atrasadas"), detail: "Remarque ou conclua.", recipe: null, taskIds: late.map((task) => task.id) });
  }
  if (missingRoutines.length) {
    const first = missingRoutines[0];
    gaps.push({
      key: "rotinas",
      severity: "media",
      title: `Faltam ${plural(missingRoutines.length, "rotina padrão", "rotinas padrão")}`,
      detail: missingRoutines.map((routine) => routine.title).join(", "),
      recipe: "rotina",
      prefill: { title: first.title, description: first.description, cadence: first.cadence, routineKey: first.key },
    });
  }
  if (noAssignee.length) {
    gaps.push({ key: "sem-responsavel", severity: "media", title: plural(noAssignee.length, "tarefa sem responsável", "tarefas sem responsável"), detail: "Ninguém é avisado sobre elas.", recipe: null, taskIds: noAssignee.map((task) => task.id) });
  }
  if (!activeAutomations.length) {
    gaps.push({ key: "sem-automacao", severity: "media", title: "Nenhuma automação ativa", detail: "O relatório semanal de anúncios ainda não roda para este cliente.", recipe: "automacao", prefill: { automationKey: "relatorio_trafego_semanal" } });
  }
  if (!plans.length) {
    gaps.push({ key: "sem-plano", severity: "baixa", title: "Nenhum plano de ação aberto", detail: "O plano dos primeiros 60 dias organiza o ciclo.", recipe: "plano" });
  }
  if (noDate.length) {
    gaps.push({ key: "sem-data", severity: "baixa", title: plural(noDate.length, "tarefa sem data", "tarefas sem data"), detail: "Não entram no calendário nem no atraso.", recipe: null, taskIds: noDate.map((task) => task.id) });
  }
  if (deliveriesNoFormat.length) {
    gaps.push({ key: "sem-formato", severity: "baixa", title: plural(deliveriesNoFormat.length, "entrega sem formato", "entregas sem formato"), detail: "Defina Reels, carrossel, banner ou story.", recipe: null, taskIds: deliveriesNoFormat.map((task) => task.id) });
  }
  if (!input.filesReady) {
    gaps.push({ key: "arquivos", severity: "baixa", title: "Pastas do cliente ainda não criadas", detail: "Os arquivos ficam no armazenamento interno até as pastas existirem no Drive.", recipe: null });
  }

  const checks: ReadinessCheck[] = [
    { key: "contrato", label: "Contrato e escopo", ok: input.hasContract },
    { key: "briefing", label: "Briefing respondido", ok: input.briefingSubmitted },
    { key: "rotinas", label: "Rotinas padrão", ok: missingRoutines.length === 0 },
    { key: "responsaveis", label: "Tarefas com responsável", ok: noAssignee.length === 0 },
    { key: "automacao", label: "Automação ativa", ok: activeAutomations.length > 0 },
    { key: "arquivos", label: "Arquivos do cliente", ok: input.filesReady },
  ];

  return {
    gaps,
    readiness: { percent: Math.round((checks.filter((check) => check.ok).length / checks.length) * 100), checks },
    operation: {
      abertas: board.length,
      atrasadas: late.length,
      paradas: stopped.length,
      semana: week.length,
      rotinasAtivas: activeRoutines.length,
      automacoesAtivas: activeAutomations.length,
      planoAtivo: plans[0] ? { id: plans[0].id, title: plans[0].title } : null,
      proximaGravacao: nextShoot ? { id: nextShoot.id, title: nextShoot.title, date: nextShoot.due_date! } : null,
    },
  };
}
