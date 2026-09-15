// As receitas do Estúdio: entradas tipadas → Blueprint + prévia. Puras (sem IO),
// então tudo o que o Estúdio promete criar é testável sem banco.
//
// Prazos seguem a jornada North (docs/northai/skills/operacao-north.md), em dias
// CORRIDOS: roteiro D-4 da gravação, gravação D-0, primeira publicação D+6 e as
// seguintes a cada 2 dias.

import { contentPlanSteps } from "@/app/admin/contentPlan";
import { AUTOMATION_DEFINITIONS, isAutomationKey } from "@/lib/automationCatalog";
import { addDaysIso } from "@/lib/time/agency";
import type { BuiltBlueprint, BlueprintOp, PreviewLine } from "./blueprint";
import type { Cadence } from "./commandParser";
import { detectFormat, formatByKey, NORTH_FORMATS, type NorthFormatKey } from "./formats";

export const addDays = addDaysIso;

export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const CADENCE_LABEL: Record<Cadence, string> = { semanal: "toda semana", quinzenal: "a cada 15 dias", mensal: "todo mês" };

/** Dias antes da gravação em que o roteiro vence. */
export const SCRIPT_LEAD_DAYS = 4;
/** Primeira publicação: dias depois da gravação. */
export const FIRST_PUBLISH_OFFSET_DAYS = 6;
/** Intervalo entre publicações. */
export const PUBLISH_INTERVAL_DAYS = 2;

export function defaultPublishDate(shootDate: string, index: number): string {
  return addDaysIso(shootDate, FIRST_PUBLISH_OFFSET_DAYS + index * PUBLISH_INTERVAL_DAYS);
}

// ---- Diária de gravação ---------------------------------------------------------

export type ShootDayDraftPiece = { title: string; format: NorthFormatKey; publishDate: string | null; body: string };

export type ShootDayDraft = {
  clientSlug: string | null;
  clientName: string;
  shootDate: string;
  /** Tipo Entrega usado pelas peças (precisa das etapas roteiro e captação). */
  typeKey: string;
  assignee: string | null;
  docUrl: string | null;
  withPlan: boolean;
  pieces: ShootDayDraftPiece[];
};

export function shootDayBlueprint(draft: ShootDayDraft): BuiltBlueprint {
  const date = shortDate(draft.shootDate);
  const count = draft.pieces.length;
  const ops: BlueprintOp[] = [];
  const preview: PreviewLine[] = [];
  const who = draft.assignee ? ` · ${draft.assignee}` : "";

  if (draft.withPlan) {
    ops.push({
      op: "createTask",
      ref: "plano",
      scope: "plan",
      task: { title: `Diária de gravação ${date} — ${draft.clientName}`, start_date: draft.shootDate, due_date: draft.pieces.at(-1)?.publishDate ?? defaultPublishDate(draft.shootDate, Math.max(0, count - 1)), assignee: draft.assignee },
    });
    preview.push({ icon: "◆", text: `Diária de gravação ${date}`, detail: "plano que reúne as peças", group: "Diária" });
  }

  const pieces = draft.pieces.map((piece, index) => {
    const format = formatByKey(piece.format);
    return {
      title: detectFormat(piece.title) ? piece.title : `${format.label} — ${piece.title}`,
      formato: format.formato,
      publishDate: piece.publishDate ?? defaultPublishDate(draft.shootDate, index),
      description: piece.body || null,
      label: format.label,
    };
  });

  ops.push({
    op: "createShootDay",
    ref: "diaria",
    ...(draft.withPlan ? { planRef: "plano" } : {}),
    typeKey: draft.typeKey,
    shootDate: draft.shootDate,
    scriptTitle: `Roteiros da diária ${date}`,
    scriptDescription: [draft.docUrl ? `Documento dos roteiros: ${draft.docUrl}` : null, draft.pieces.map((piece, index) => `${index + 1}. ${piece.title}`).join("\n")].filter(Boolean).join("\n\n"),
    captureTitle: `Gravação ${date} — ${plural(count, "publicação", "publicações")}`,
    assignee: draft.assignee,
    pieces: pieces.map(({ label: _label, ...piece }) => { void _label; return piece; }),
  });

  const scriptDue = addDaysIso(draft.shootDate, -SCRIPT_LEAD_DAYS);
  preview.push(
    { icon: "✎", text: `Roteiro — vence ${shortDate(scriptDue)}`, detail: `serve às ${plural(count, "peça", "peças")}${who}`, group: "Compartilhado" },
    { icon: "●", text: `Captação — ${date}`, detail: `a mesma gravação para todas${who}`, group: "Compartilhado" },
  );
  for (const piece of pieces) {
    preview.push({ icon: "✦", text: piece.title, detail: `publicação ${shortDate(piece.publishDate)}`, indent: true, group: "Peças" });
  }
  preview.push({ icon: "↳", text: `${plural(count, "edição será criada", "edições serão criadas")} automaticamente`, detail: "uma por peça, cada uma seguida da sua publicação", group: "Depois da captação" });

  return { blueprint: { recipe: "diaria", title: `Diária de gravação ${date}`, clientSlug: draft.clientSlug, ops }, preview };
}

// ---- Plano de ação --------------------------------------------------------------

export type PlanDraft = {
  clientSlug: string | null;
  title: string;
  startDate: string;
  assignee: string | null;
  counts: Partial<Record<NorthFormatKey, number>>;
  extraTasks: string[];
};

export function planBlueprint(draft: PlanDraft): BuiltBlueprint {
  const ops: BlueprintOp[] = [{
    op: "createTask",
    ref: "plano",
    scope: "plan",
    task: { title: draft.title, start_date: draft.startDate, due_date: addDaysIso(draft.startDate, 14), assignee: draft.assignee },
  }];
  const preview: PreviewLine[] = [{ icon: "◆", text: draft.title, detail: `começa ${shortDate(draft.startDate)}${draft.assignee ? ` · ${draft.assignee}` : ""}`, group: "Plano" }];

  const n = (key: NorthFormatKey) => Math.max(0, draft.counts[key] ?? 0);
  const steps = contentPlanSteps({ reels: n("reels"), anuncios: n("anuncio"), carrosseis: n("carrossel") });
  const designOnly = (["banner", "story", "post"] as const).filter((key) => n(key) > 0);
  const tasks = [
    ...steps.map((step) => ({ title: step.title, description: step.description, offset: step.offsetDays })),
    ...designOnly.map((key) => ({ title: `Design — ${plural(n(key), formatByKey(key).label.toLowerCase(), formatByKey(key).plural.toLowerCase())}`, description: null, offset: 7 })),
    ...draft.extraTasks.filter((title) => title.trim()).map((title) => ({ title: title.trim(), description: null, offset: 7 })),
  ];
  for (const [index, task] of tasks.entries()) {
    const due = addDaysIso(draft.startDate, task.offset);
    ops.push({
      op: "createTask",
      ref: `atividade-${index + 1}`,
      scope: "task",
      planRef: "plano",
      task: { title: task.title, description: task.description, kind: "operacional", assignee: draft.assignee, due_date: due, start_date: due },
    });
    preview.push({ icon: "●", text: task.title, detail: `prazo ${shortDate(due)}`, indent: true, group: "Atividades" });
  }

  return { blueprint: { recipe: "plano", title: draft.title, clientSlug: draft.clientSlug, ops }, preview };
}

// ---- Rotina ---------------------------------------------------------------------

export type RoutineDraft = {
  clientSlug: string | null;
  title: string;
  description: string | null;
  /** null = acontece uma vez (ex.: kickoff), vira tarefa com data. */
  cadence: Cadence | null;
  startDate: string;
  weekdays: number[];
  assignee: string | null;
  /** Rotina padrão do cadastro que este card cumpre (lib/clientRoutines.ts). */
  routineKey?: string | null;
};

export function routineBlueprint(draft: RoutineDraft): BuiltBlueprint {
  const task = {
    title: draft.title,
    description: draft.description,
    assignee: draft.assignee,
    start_date: draft.startDate,
    due_date: draft.startDate,
    ...(draft.routineKey ? { routineKey: draft.routineKey } : {}),
    ...(draft.cadence ? { recurrence_cadence: draft.cadence, recurrence_weekdays: draft.weekdays } : {}),
  };
  const when = draft.cadence
    ? `${CADENCE_LABEL[draft.cadence]}${draft.weekdays.length ? ` (${draft.weekdays.map((day) => WEEKDAY_LABEL[day]).join(", ")})` : ""} · começa ${shortDate(draft.startDate)}`
    : `uma vez · ${shortDate(draft.startDate)}`;
  return {
    blueprint: {
      recipe: "rotina",
      title: draft.title,
      clientSlug: draft.clientSlug,
      ops: [{ op: "createTask", ref: "rotina", scope: draft.cadence ? "routine" : "task", task }],
    },
    preview: [{ icon: draft.cadence ? "↻" : "●", text: draft.title, detail: `${when}${draft.assignee ? ` · ${draft.assignee}` : ""}`, group: draft.cadence ? "Rotina" : "Tarefa" }],
  };
}

// ---- Fluxo (entregas em cascata) ------------------------------------------------

export type FlowDraft = {
  clientSlug: string | null;
  typeKey: string;
  typeLabel: string;
  title: string;
  count: number;
  format: NorthFormatKey;
  dueDate: string | null;
  assignee: string | null;
  planId: string | null;
};

export function flowBlueprint(draft: FlowDraft): BuiltBlueprint {
  const count = Math.max(1, Math.min(40, Math.trunc(draft.count)));
  const format = formatByKey(draft.format);
  const titles = Array.from({ length: count }, (_, index) => (count > 1 ? `${draft.title} ${index + 1}` : draft.title));
  const ops: BlueprintOp[] = titles.map((title, index) => ({
    op: "createTask" as const,
    ref: `fluxo-${index + 1}`,
    scope: "task" as const,
    ...(draft.planId ? { planId: draft.planId } : {}),
    task: { title, kind: draft.typeKey, formato: format.formato, assignee: draft.assignee, due_date: draft.dueDate, start_date: draft.dueDate },
  }));
  return {
    blueprint: { recipe: "fluxo", title: draft.title, clientSlug: draft.clientSlug, ops },
    preview: [
      ...titles.map((title) => ({ icon: "✦", text: `${title} — ${format.label}`, detail: draft.dueDate ? `prazo ${shortDate(draft.dueDate)}` : "sem prazo", group: "Entregas" })),
      { icon: "↳", text: "Cada entrega nasce na primeira etapa", detail: "concluir uma etapa cria a próxima", group: "Depois" },
    ],
  };
}

// ---- Automação -------------------------------------------------------------------

export type AutomationDraft = {
  clientSlug: string | null;
  automationKey: string;
  targetTaskId: string | null;
  targetTitle: string | null;
  /** Sem rotina existente: cria uma rotina para a automação morar. */
  newTarget: { title: string; cadence: Cadence; startDate: string; assignee: string | null } | null;
  performanceTemplateId: string | null;
};

export function automationBlueprint(draft: AutomationDraft): BuiltBlueprint {
  if (!isAutomationKey(draft.automationKey)) throw new Error("Escolha uma automação.");
  const definition = AUTOMATION_DEFINITIONS[draft.automationKey];
  const ops: BlueprintOp[] = [];
  const preview: PreviewLine[] = [];
  if (draft.newTarget) {
    ops.push({
      op: "createTask",
      ref: "alvo",
      scope: "routine",
      task: { title: draft.newTarget.title, assignee: draft.newTarget.assignee, start_date: draft.newTarget.startDate, due_date: draft.newTarget.startDate, recurrence_cadence: draft.newTarget.cadence },
    });
    preview.push({ icon: "↻", text: draft.newTarget.title, detail: `${CADENCE_LABEL[draft.newTarget.cadence]} · começa ${shortDate(draft.newTarget.startDate)}`, group: "Rotina" });
  } else if (!draft.targetTaskId) {
    throw new Error("Escolha a rotina ou crie uma nova para a automação.");
  }
  ops.push({
    op: "createAutomation",
    ref: "automacao",
    automationKey: draft.automationKey,
    ...(draft.newTarget ? { targetRef: "alvo" } : { targetTaskId: draft.targetTaskId! }),
    performanceTemplateId: draft.performanceTemplateId,
  });
  preview.push({ icon: "⚙", text: definition.label, detail: `roda na rotina "${draft.newTarget?.title ?? draft.targetTitle ?? "escolhida"}"`, group: "Automação" });
  return { blueprint: { recipe: "automacao", title: definition.label, clientSlug: draft.clientSlug, ops }, preview };
}

export const FORMAT_OPTIONS = NORTH_FORMATS.map((format) => ({ key: format.key, label: format.label }));
