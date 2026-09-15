// As receitas do Estúdio: entradas tipadas → Blueprint + prévia. Puras (sem IO),
// então tudo o que o Estúdio promete criar é testável sem banco.
//
// Prazos seguem a jornada North (docs/northai/skills/operacao-north.md):
// roteiro D-4 da gravação, gravação D-0, edição +4 dias, publicações
// espalhadas a cada 2 dias depois da edição.

import { contentPlanSteps } from "@/app/admin/contentPlan";
import { AUTOMATION_DEFINITIONS, isAutomationKey } from "@/lib/automationCatalog";
import type { BuiltBlueprint, BlueprintOp, PreviewLine } from "./blueprint";
import type { Cadence } from "./commandParser";
import { detectFormat, formatByKey, NORTH_FORMATS, type NorthFormatKey } from "./formats";

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Publicação da peça i: edição termina em +4 dias; a partir de +6, uma a cada 2 dias (calendário do ciclo). */
export function defaultPublishDate(shootDate: string, index: number): string {
  return addDays(shootDate, 6 + index * 2);
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

  if (draft.withPlan) {
    ops.push({
      op: "createTask",
      ref: "plano",
      scope: "plan",
      task: { title: `Diária de gravação ${date} — ${draft.clientName}`, start_date: draft.shootDate, due_date: draft.pieces.at(-1)?.publishDate ?? draft.shootDate, assignee: draft.assignee },
    });
    preview.push({ icon: "◆", text: `Plano "Diária de gravação ${date}"`, detail: "agrupa as publicações da diária" });
  }

  const titles = draft.pieces.map((piece, index) => `${index + 1}. ${piece.title}`).join("\n");
  ops.push({
    op: "createShootDay",
    ref: "diaria",
    ...(draft.withPlan ? { planRef: "plano" } : {}),
    typeKey: draft.typeKey,
    shootDate: draft.shootDate,
    scriptTitle: `Roteiros da diária ${date}`,
    scriptDescription: [draft.docUrl ? `Documento dos roteiros: ${draft.docUrl}` : null, titles].filter(Boolean).join("\n\n"),
    captureTitle: `Gravação ${date} — ${plural(count, "publicação", "publicações")}`,
    assignee: draft.assignee,
    pieces: draft.pieces.map((piece, index) => {
      const format = formatByKey(piece.format);
      return {
        title: detectFormat(piece.title) ? piece.title : `${format.label} — ${piece.title}`,
        formato: format.formato,
        publishDate: piece.publishDate ?? defaultPublishDate(draft.shootDate, index),
        description: piece.body || null,
      };
    }),
  });

  preview.push(
    { icon: "✎", text: `1 roteiro para as ${plural(count, "peça", "peças")}`, detail: `vence ${shortDate(addDays(draft.shootDate, -4))}` },
    { icon: "●", text: `1 gravação em ${date}`, detail: "a mesma captação para todas" },
  );
  for (const [index, piece] of draft.pieces.entries()) {
    const format = formatByKey(piece.format);
    preview.push({
      icon: "✦",
      text: `${format.label}: ${piece.title}`,
      detail: `edição e publicação próprias · publica ${shortDate(piece.publishDate ?? defaultPublishDate(draft.shootDate, index))}`,
      indent: true,
    });
  }

  return {
    blueprint: { recipe: "diaria", title: `Diária de gravação ${date}`, clientSlug: draft.clientSlug, ops },
    preview,
  };
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
    task: { title: draft.title, start_date: draft.startDate, due_date: addDays(draft.startDate, 14), assignee: draft.assignee },
  }];
  const preview: PreviewLine[] = [{ icon: "◆", text: `Plano "${draft.title}"` }];

  const n = (key: NorthFormatKey) => Math.max(0, draft.counts[key] ?? 0);
  const steps = contentPlanSteps({ reels: n("reels"), anuncios: n("anuncio"), carrosseis: n("carrossel") });
  const designOnly = (["banner", "story", "post"] as const).filter((key) => n(key) > 0);
  const tasks = [
    ...steps.map((step) => ({ title: step.title, description: step.description, offset: step.offsetDays })),
    ...designOnly.map((key) => ({ title: `Design — ${plural(n(key), formatByKey(key).label.toLowerCase(), formatByKey(key).plural.toLowerCase())}`, description: null, offset: 7 })),
    ...draft.extraTasks.filter((title) => title.trim()).map((title) => ({ title: title.trim(), description: null, offset: 7 })),
  ];
  for (const [index, task] of tasks.entries()) {
    ops.push({
      op: "createTask",
      ref: `atividade-${index + 1}`,
      scope: "task",
      planRef: "plano",
      task: { title: task.title, description: task.description, kind: "operacional", assignee: draft.assignee, due_date: addDays(draft.startDate, task.offset), start_date: addDays(draft.startDate, task.offset) },
    });
    preview.push({ icon: "●", text: task.title, detail: `prazo ${shortDate(addDays(draft.startDate, task.offset))}`, indent: true });
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
};

export function routineBlueprint(draft: RoutineDraft): BuiltBlueprint {
  const task = {
    title: draft.title,
    description: draft.description,
    assignee: draft.assignee,
    start_date: draft.startDate,
    due_date: draft.startDate,
    ...(draft.cadence ? { recurrence_cadence: draft.cadence, recurrence_weekdays: draft.weekdays } : {}),
  };
  const when = draft.cadence
    ? `${draft.cadence}${draft.weekdays.length ? ` · ${draft.weekdays.map((day) => WEEKDAY_LABEL[day]).join(", ")}` : ""} · começa ${shortDate(draft.startDate)}`
    : `uma vez · ${shortDate(draft.startDate)}`;
  return {
    blueprint: {
      recipe: "rotina",
      title: draft.title,
      clientSlug: draft.clientSlug,
      ops: [{ op: "createTask", ref: "rotina", scope: draft.cadence ? "routine" : "task", task }],
    },
    preview: [{ icon: draft.cadence ? "↻" : "●", text: draft.title, detail: `${when}${draft.assignee ? ` · ${draft.assignee}` : ""}` }],
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
  const ops: BlueprintOp[] = Array.from({ length: count }, (_, index) => ({
    op: "createTask" as const,
    ref: `fluxo-${index + 1}`,
    scope: "task" as const,
    ...(draft.planId ? { planId: draft.planId } : {}),
    task: {
      title: count > 1 ? `${draft.title} ${index + 1}` : draft.title,
      kind: draft.typeKey,
      formato: format.formato,
      assignee: draft.assignee,
      due_date: draft.dueDate,
      start_date: draft.dueDate,
    },
  }));
  return {
    blueprint: { recipe: "fluxo", title: draft.title, clientSlug: draft.clientSlug, ops },
    preview: [{
      icon: "✦",
      text: `${plural(count, "entrega", "entregas")} de ${draft.typeLabel} — ${format.label}`,
      detail: `cada uma nasce na primeira etapa e cria a próxima ao concluir${draft.dueDate ? ` · prazo ${shortDate(draft.dueDate)}` : ""}`,
    }],
  };
}

// ---- Automação -------------------------------------------------------------------

export type AutomationDraft = {
  clientSlug: string | null;
  automationKey: string;
  targetTaskId: string | null;
  targetTitle: string | null;
  /** Sem card-alvo existente: cria uma rotina para a automação morar. */
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
      task: {
        title: draft.newTarget.title,
        assignee: draft.newTarget.assignee,
        start_date: draft.newTarget.startDate,
        due_date: draft.newTarget.startDate,
        recurrence_cadence: draft.newTarget.cadence,
      },
    });
    preview.push({ icon: "↻", text: `Rotina "${draft.newTarget.title}"`, detail: `${draft.newTarget.cadence} · começa ${shortDate(draft.newTarget.startDate)}` });
  } else if (!draft.targetTaskId) {
    throw new Error("Escolha o card-alvo ou crie uma rotina para a automação.");
  }
  ops.push({
    op: "createAutomation",
    ref: "automacao",
    automationKey: draft.automationKey,
    ...(draft.newTarget ? { targetRef: "alvo" } : { targetTaskId: draft.targetTaskId! }),
    performanceTemplateId: draft.performanceTemplateId,
  });
  preview.push({ icon: "⚙", text: definition.label, detail: `no card "${draft.newTarget?.title ?? draft.targetTitle ?? "escolhido"}"`, indent: Boolean(draft.newTarget) });
  return { blueprint: { recipe: "automacao", title: definition.label, clientSlug: draft.clientSlug, ops }, preview };
}

export const FORMAT_OPTIONS = NORTH_FORMATS.map((format) => ({ key: format.key, label: format.label }));
