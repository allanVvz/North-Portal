import type { TaskStatus } from "@/lib/validation";

// Formatação de datas compartilhada pelos cards minimizados de Tarefas e de
// Clientes/Rotinas. Antes vivia privada dentro de ClientsWorkspace.tsx, que era
// justamente o motivo do card de Tarefas não mostrar prazo nenhum: o helper
// existia, mas não era importável.
//
// Todas as entradas são `YYYY-MM-DD` (colunas `date` do Postgres). Nada aqui
// constrói um Date a partir da string crua sem fixar o horário — `new
// Date("2026-08-12")` é meia-noite UTC, que em BRT ainda é dia 11.

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** `"12 ago"` — ou `"Sem data"` quando não há prazo. */
export function formatShortDate(value: string | null): string {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "Sem data";
}

/** "hoje" / "amanhã" / "há 3 dias" — uma data absoluta sozinha obriga a contar de cabeça. */
export function relativeDue(value: string | null, today: string): string | null {
  if (!value) return null;
  const days = Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  if (days < 0) return `há ${Math.abs(days)} dias`;
  if (days <= 30) return `em ${days} dias`;
  return null;
}

/**
 * `"01 ago → 15 ago"` para datas que representam um período.
 *
 * Retorna `null` em dois casos, para o card nunca mostrar duas datas quando na
 * verdade só existe uma:
 *
 * - **Falta uma das pontas** — meia informação de período é pior que nenhuma:
 *   "01 ago → Sem data" parece um bug, e uma ponta só já é coberta pelo prazo
 *   normal do card.
 * - **As duas pontas são iguais** — "12 ago → 12 ago" não é um período, é a
 *   mesma data repetida ao lado do prazo que o card já mostra.
 */
export function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start || !end || start === end) return null;
  return `${formatShortDate(start)} → ${formatShortDate(end)}`;
}

// Um card entregue não fica atrasado retroativamente: depois de Concluído o
// prazo deixou de ser uma cobrança e a tag vermelha vira ruído.
const SETTLED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["aprovado"]);

export function isOverdue(dueDate: string | null, today: string, status: TaskStatus): boolean {
  if (!dueDate || SETTLED.has(status)) return false;
  return dueDate < today;
}
