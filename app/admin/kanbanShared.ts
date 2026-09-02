import { commentsOf as commentsOfPayload, type TaskComment } from "@/lib/comments";
import type { TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { kindTone } from "@/lib/taskCatalog";

export type { TaskComment };

// "Parada" vem PRIMEIRO, à esquerda de Entrada. Ela não é a etapa seguinte a
// Concluído — é onde um card trava quando uma automação falha, antes de qualquer
// progresso. Colocada no fim, a coluna sugeria um estágio final do fluxo, que é
// o oposto do que significa.
export const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "parada", label: "Parada" },
  { status: "backlog", label: "Entrada" },
  { status: "em_producao", label: "Em produção" },
  { status: "revisao", label: "Revisão" },
  { status: "aprovacao", label: "Aprovação" },
  { status: "aprovado", label: "Concluído" },
];
export const STATUS_ORDER = COLUMNS.map((c) => c.status);

/** A progressão real do fluxo, sem `parada`.
 *
 *  Quem calcula "etapas já cumpridas" precisa desta lista, não de STATUS_ORDER:
 *  com `parada` no índice 0, qualquer comparação por índice a marcaria como
 *  cumprida em toda tarefa. E um card parado não tem etapa cumprida nenhuma —
 *  ele travou, não avançou. `indexOf` devolve -1 para `parada`, que é
 *  exatamente a leitura desejada.
 *
 *  Isto é ordem de EXIBIÇÃO. O progresso numérico do card continua saindo de
 *  TASK_STATUSES (lib/validation.ts) via taskProgress(), que não mudou. */
//  Tipado como TaskStatus[] de propósito, e não pelo estreitamento do filter:
//  quem consulta passa o status corrente do card, que PODE ser "parada", e -1 é
//  a resposta certa nesse caso.
export const WORKFLOW_ORDER: TaskStatus[] = STATUS_ORDER.filter((status) => status !== "parada");
export const STATUS_LABEL: Record<TaskStatus, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.status, c.label]),
) as Record<TaskStatus, string>;

// Revisão/Aprovação are the only columns that can disappear. Primarily
// toggle-driven: as soon as ANY client has that stage's "Ativo para Admin"
// switched on, the column is ALWAYS shown on the shared cross-client board —
// even with zero cards in it — so an admin can immediately drag cards into
// it. Turning the toggle off hides the column again (its cards get cascaded
// to "em_producao" by saveClientFlowFlags, see lib/supabase.ts). The
// `tasks.some(...)` half is a pure safety net — a column that somehow still
// has a card sitting in it (stale flag, migration gap, whatever) must never
// disappear out from under that card.
export function visibleColumnsFor(
  tasks: { status: TaskStatus }[],
  anyClientRevisaoAdmin: boolean,
  anyClientAprovacaoAdmin: boolean,
): typeof COLUMNS {
  const hasRevisao = anyClientRevisaoAdmin || tasks.some((t) => t.status === "revisao");
  const hasAprovacao = anyClientAprovacaoAdmin || tasks.some((t) => t.status === "aprovacao");
  // "Parada" has no per-client "Ativo para Admin" toggle — it isn't an
  // optional workflow stage, it's an automation-error indicator, so it only
  // ever shows up when a card is actually sitting in it.
  const hasParada = tasks.some((t) => t.status === "parada");
  return COLUMNS.filter(
    (c) =>
      (c.status !== "revisao" || hasRevisao) &&
      (c.status !== "aprovacao" || hasAprovacao) &&
      (c.status !== "parada" || hasParada),
  );
}

// `tasksForKanbanColumn` e `statusAfterKanbanDrop` moravam aqui e foram
// removidas com a etapa "Publicado". As duas existiam só para projetar cards
// publicados dentro da coluna Concluído sem mexer no status deles — um
// problema que some junto com o estágio. Agora a coluna filtra por igualdade
// de status e o drop grava o status da coluna, sem exceção nenhuma.

// Kind vocabulary/labels/icons/tones now live in the in-code catalog
// (lib/taskCatalog.ts). Re-exported here for the few call sites still importing
// them from this module.
export { TASK_KINDS, TASK_KIND_KEYS, kindLabel, kindTone, kindIcon, kindDef, subtypeLabel } from "@/lib/taskCatalog";

export const PRIORITY_LABEL: Record<TaskPriority, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };
export const TONES = ["green", "gold", "blue", "purple", "neutral"] as const;

export const FORMATO_OPTIONS = ["Reels vertical", "Stories", "Post feed", "Carrossel", "Vídeo horizontal", "Flyer"];
export const PLATAFORMA_OPTIONS = ["Instagram", "TikTok", "YouTube", "Facebook", "Google", "WhatsApp"];

// Regra única de iniciais — mora em app/avatar/initials.ts. Reexportada daqui
// porque boa parte do Kanban já importava `initials` deste módulo.
export { initialsOf as initials } from "../avatar/initials";

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "agora";
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return `há ${Math.floor(diff / 60000)} min`;
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** The colored pill tone for a task: explicit payload tone, else derived from kind. */
export function taskTone(t: TaskRecord): string {
  const p = (t.payload ?? {}) as Record<string, unknown>;
  if (typeof p.barTone === "string") return p.barTone;
  if (typeof p.statusTone === "string") return p.statusTone;
  return kindTone(t.kind);
}

export function commentsOf(task: TaskRecord): TaskComment[] {
  return commentsOfPayload(task.payload);
}

// A reviewer is never a client before Aprovação, and never an admin once the
// card is client-facing — this decides which reviewer list applies.
export function reviewerStageFor(status: TaskStatus): "admin" | "client" {
  return status === "aprovacao" || status === "aprovado" ? "client" : "admin";
}

// A busca textual de tarefa é canônica e mora em lib/taskSearch.ts
// (taskSearchText / taskMatchesQuery) — cobre também comentários, autor,
// subtipo, status e datas formatadas, com múltiplos termos em E e sem acento.
// STATUS_LABEL e PRIORITY_LABEL acima são a fonte dos rótulos que ela usa.
