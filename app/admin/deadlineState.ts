import type { TaskStatus } from "@/lib/validation";

// A situação de uma tarefa — a pergunta que a reunião de 14/09 pediu para ser a
// PRIMEIRA informação de todo card: está parada, atrasada, concluída ou no prazo?
//
// É diferente da etapa (Entrada, Em produção, Revisão…). A etapa diz em que
// ponto do funil o card está; a situação diz se alguém precisa agir. Uma tarefa
// em Revisão pode estar no prazo ou atrasada, e a tela precisa dizer as duas
// coisas sem que uma esconda a outra.
//
// Regra do atraso (ATA 14/09): data prevista de entrega vencida e status
// diferente de concluído. Vale para cada etapa de um fluxo, porque cada etapa é
// um card com a própria data.

export type DeadlineState = "parada" | "atrasada" | "concluida" | "no_prazo";

export const DEADLINE_ORDER: DeadlineState[] = ["atrasada", "parada", "no_prazo", "concluida"];

export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  parada: "Parada",
  atrasada: "Atrasada",
  concluida: "Concluída",
  no_prazo: "No prazo",
};

/** `today` é `YYYY-MM-DD` no fuso da agência (todayInTimezone). */
export function deadlineStateOf(task: { status: TaskStatus; due_date: string | null }, today: string): DeadlineState {
  // Parada vence atrasada: o card travou, e destravar vem antes de correr atrás
  // do prazo. Concluída vence as duas: entregue não fica atrasada retroativamente.
  if (task.status === "aprovado") return "concluida";
  if (task.status === "parada") return "parada";
  if (task.due_date && task.due_date.slice(0, 10) < today) return "atrasada";
  return "no_prazo";
}

/** Precisa de ação de alguém agora — o que a Home do responsável prioriza. */
export function needsAttention(state: DeadlineState): boolean {
  return state === "atrasada" || state === "parada";
}
