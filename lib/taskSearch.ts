// Busca textual canônica de tarefas/cards — uma implementação para todas as
// telas admin (Tarefas, Rotinas, Entregas, Plano de Ação, Automações, e os
// pickers do modal do card).
//
// Antes desta rodada havia 6+ haystacks independentes: `taskSearchText` no
// Kanban, um filtro inline no KanbanBoard que nem batia com a própria barra de
// busca, `recurringSearchText` nas Rotinas, `parentMatches` nas Entregas, mais
// duas buscas só-título nos pickers. Cada uma olhava um subconjunto diferente
// de campos e nenhuma entrava nos comentários.
//
// Regras desta busca:
//  - Cobre todo o texto que já está carregado no navegador junto do card —
//    título, descrição, comentários (texto E autor), responsável, cliente,
//    autor, rótulos de tipo/subtipo/status/prioridade, campos de payload e
//    datas (crua + formatada). Anexos, métricas e revisor/aprovador ficam de
//    fora: exigiriam uma query extra por tela.
//  - Múltiplos termos são E: "ana relatorio" casa só com cards que têm as duas
//    palavras em qualquer lugar do haystack.
//  - Acento-insensível nos dois lados ("relatorio" acha "relatório").

import { commentsOf } from "@/lib/comments";
import { kindLabel, subtypeLabel } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/app/admin/kanbanShared";
import { formatShortDate } from "@/app/admin/taskDates";

/** NFD + remoção de diacríticos + minúsculas. Mesma transformação já usada em
 *  lib/documentFiles.ts e no slug de cliente. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type TaskSearchContext = {
  /** Nome do cliente — é um campo de join, não está no TaskRecord. */
  clientName?: string | null;
  /** Rótulo do tipo por agência (task_types.label), usado pelos cards-pai.
   *  Somado a kindLabel(task.kind), não no lugar dele. */
  typeLabel?: string | null;
  /** Rótulos extras específicos da tela — as Rotinas passam
   *  [rótulo de cadência, rótulo de estado]. */
  extra?: Array<string | null | undefined>;
};

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

/** A string crua da data e a sua forma pt-BR ("15 set"). Descarta o formatado
 *  quando `formatShortDate` devolve "Sem data" (data em texto livre não
 *  parseável) — senão a frase "sem data" casaria com todo card. */
function searchableDate(value: string | null): string[] {
  if (!value) return [];
  const short = formatShortDate(value);
  return short === "Sem data" ? [value] : [value, short];
}

// Só a parte cara do haystack (join de até 200 comentários, lookups de rótulo,
// formatação de data) é cacheada. A chave é a REFERÊNCIA do objeto task —
// objetos task são substituídos por inteiro a cada load()/router.refresh(), e o
// WeakMap deixa o GC recolher feeds antigos.
const baseCache = new WeakMap<TaskRecord, string>();

function baseHaystack(task: TaskRecord): string {
  const hit = baseCache.get(task);
  if (hit !== undefined) return hit;

  const payload = task.payload ?? {};
  const parts: Array<string | null | undefined> = [
    task.title,
    task.description,
    kindLabel(task.kind),
    subtypeLabel(task.subtype),
    STATUS_LABEL[task.status],
    PRIORITY_LABEL[task.priority],
    task.assignee,
    task.created_by_name,
    payloadString(payload, "formato"),
    payloadString(payload, "plataforma"),
    payloadString(payload, "hora"),
    payloadString(payload, "statusLabel"),
    ...searchableDate(task.due_date),
    ...searchableDate(task.start_date),
    ...searchableDate(task.end_date),
  ];

  for (const comment of commentsOf(payload)) {
    parts.push(comment.text, comment.author);
  }

  const built = normalizeSearchText(parts.filter(Boolean).join(" "));
  baseCache.set(task, built);
  return built;
}

/** Haystack normalizado e memoizado de um card, com os campos de contexto
 *  concatenados por último (fora do cache — o mesmo objeto task aparece em
 *  telas diferentes com clientName diferente). */
export function taskSearchText(task: TaskRecord, ctx: TaskSearchContext = {}): string {
  const ctxStr = normalizeSearchText(
    [ctx.clientName, ctx.typeLabel, ...(ctx.extra ?? [])].filter(Boolean).join(" "),
  );
  const base = baseHaystack(task);
  return ctxStr ? `${base} ${ctxStr}` : base;
}

/** Divide a query em termos por espaço; cada termo tem que aparecer em algum
 *  lugar do haystack (E). Query vazia casa com tudo. */
export function taskMatchesQuery(task: TaskRecord, query: string, ctx: TaskSearchContext = {}): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = taskSearchText(task, ctx);
  return terms.every((term) => haystack.includes(term));
}
