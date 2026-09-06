// Os três filtros da view Estratégica: quem, quando e por quê.
//
// A tela já respondia essas três perguntas — mas só como texto estático, um
// bloco de dica ("Defina quem assume cada entrega"). O que a spec pede é que as
// mesmas três perguntas virem a forma de FILTRAR: a pergunta que o cabeçalho já
// fazia passa a ser a que a pessoa responde para reduzir a lista.
//
// Puro de propósito, sem React: é aqui que moram as decisões de borda (plano
// sem data, plano sem responsável, intervalo aberto de um lado só), e elas
// merecem teste direto em vez de virem por dentro de um componente.

import { parseAssignees } from "@/lib/assignees";
import { normalizeSearchText } from "@/lib/taskSearch";

export type StrategicFilter = {
  /** Nome (ou pedaço de nome) de responsável. */
  who: string;
  /** Intervalo ISO; qualquer uma das pontas pode vir vazia. */
  from: string;
  to: string;
  /** Texto livre casado contra a justificativa do plano. */
  why: string;
};

export const EMPTY_STRATEGIC_FILTER: StrategicFilter = { who: "", from: "", to: "", why: "" };

export function isFilterActive(filter: StrategicFilter): boolean {
  return Boolean(filter.who || filter.from || filter.to || filter.why);
}

type FilterablePlan = {
  assignee: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  activities: { assignee: string | null; due_date: string | null; start_date: string | null }[];
};

/** Todo mundo que aparece no plano: o responsável do próprio card mais os das
 * atividades. Filtrar por "quem" olhando só o campo do pai esconderia
 * exatamente o caso que esta view existe para mostrar — o plano cujo dono é uma
 * pessoa e cujo trabalho está espalhado por outras. */
export function planPeople(plan: FilterablePlan): string[] {
  const names = new Map<string, string>();
  for (const value of [plan.assignee, ...plan.activities.map((a) => a.assignee)]) {
    for (const name of parseAssignees(value)) {
      const key = name.toLocaleLowerCase("pt-BR");
      if (!names.has(key)) names.set(key, name);
    }
  }
  return Array.from(names.values());
}

export function matchesWho(plan: FilterablePlan, who: string): boolean {
  const needle = normalizeSearchText(who).trim();
  if (!needle) return true;
  return planPeople(plan).some((name) => normalizeSearchText(name).includes(needle));
}

/** A janela do plano. Preferência pelas datas do próprio card; sem elas, o
 * intervalo que as atividades ocupam — um plano sem data própria mas com
 * atividades marcadas ainda acontece em algum momento, e some do filtro se a
 * gente fingir que não. */
export function planWindow(plan: FilterablePlan): { start: string; end: string } | null {
  const own = [plan.start_date, plan.end_date, plan.due_date].filter((d): d is string => Boolean(d));
  if (own.length) {
    const sorted = [...own].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  }
  const fromActivities = plan.activities
    .flatMap((a) => [a.start_date, a.due_date])
    .filter((d): d is string => Boolean(d))
    .sort();
  if (!fromActivities.length) return null;
  return { start: fromActivities[0], end: fromActivities[fromActivities.length - 1] };
}

/** Interseção, não contenção: um plano de três meses aparece quando se olha
 * qualquer semana dentro dele. Exigir que ele coubesse inteiro na janela
 * esconderia justamente os planos longos, que são os que mais interessam aqui.
 *
 * Plano sem data nenhuma NÃO casa com um filtro de período: quem escolheu uma
 * janela está perguntando o que acontece nela, e um plano sem data não tem como
 * responder que sim. */
export function matchesWhen(plan: FilterablePlan, from: string, to: string): boolean {
  if (!from && !to) return true;
  const window = planWindow(plan);
  if (!window) return false;
  if (from && window.end < from) return false;
  if (to && window.start > to) return false;
  return true;
}

/** Mesma regra da busca de tarefas: termos em E, sem acento, sem caixa. */
export function matchesWhy(plan: FilterablePlan, why: string): boolean {
  const terms = normalizeSearchText(why).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearchText(plan.description ?? "");
  return terms.every((term) => haystack.includes(term));
}

export function filterPlans<T extends FilterablePlan>(plans: readonly T[], filter: StrategicFilter): T[] {
  if (!isFilterActive(filter)) return [...plans];
  return plans.filter(
    (plan) => matchesWho(plan, filter.who) && matchesWhen(plan, filter.from, filter.to) && matchesWhy(plan, filter.why),
  );
}

/** Abaixo de 5 planos na tela, o acordeão abre sozinho.
 *
 * O padrão recolhido existe porque a tela sem filtro é uma parede de swimlanes
 * de todos os clientes. Quando o filtro já reduziu a lista a punhado, esse
 * motivo evaporou e o clique a mais em cada card vira pedágio — a pessoa
 * filtrou justamente para ver o conteúdo. */
export const AUTO_EXPAND_LIMIT = 5;

export function shouldAutoExpand(visibleCount: number): boolean {
  return visibleCount > 0 && visibleCount < AUTO_EXPAND_LIMIT;
}

/** As primeiras palavras da justificativa, para a lista do dropdown "Por quê" —
 * é o que deixa a opção reconhecível sem despejar o parágrafo inteiro. */
export function whyPreview(description: string | null, maxChars = 72): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  // Corta na última palavra inteira que cabe, para não terminar no meio dela.
  const clipped = text.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
