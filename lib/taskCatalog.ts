// In-code catalog for the task/Kanban model (v2). The `kind`/`subtype` columns
// on `tasks` are free TEXT; this file is the single source of truth for the
// vocabulary (which kinds/subtypes exist, their labels, icons, tones), the
// progress workflows, and the progress calculation. Adding a kind or tweaking a
// workflow percentage is a code change here — no DB migration needed. Kept as a
// one-way dependency on lib/validation (status list + TaskRecord type) so
// validation never has to import back.

import { TASK_STATUSES, type TaskRecord, type TaskStatus } from "@/lib/validation";

// ---- Kinds --------------------------------------------------------------------

export type TaskKind =
  | "plano_acao"
  | "criativo"
  | "agendamento"
  | "planejamento"
  | "operacional"
  | "checkpoint_comercial";

export type WorkflowKey = "padrao" | "criativo_pub" | "simples";

export type KindDef = {
  label: string;
  icon: string;
  tone: "green" | "gold" | "blue" | "purple" | "neutral";
  blurb: string;
  workflow: WorkflowKey;
  performance: boolean; // eligible to hold task_metrics + show in Performance
  isPlan?: boolean; // aggregates member tasks; progress is a rollup
  subtypes?: string[]; // subtype keys (labels in SUBTYPE_LABEL)
};

export const TASK_KINDS: Record<TaskKind, KindDef> = {
  plano_acao: {
    label: "Plano de Ação",
    icon: "◆",
    tone: "green",
    blurb: "Agrega tarefas, datas e progresso do conjunto",
    workflow: "padrao",
    performance: true,
    isPlan: true,
  },
  criativo: {
    label: "Criativo",
    icon: "✦",
    tone: "purple",
    blurb: "Formato, plataforma, roteiro e aprovação",
    workflow: "criativo_pub",
    performance: true,
  },
  agendamento: {
    label: "Agendamento",
    icon: "◔",
    tone: "gold",
    blurb: "Data, hora, plataforma e publicação",
    workflow: "padrao",
    performance: false,
    subtypes: ["visita_comercial", "gravacao", "reuniao_alinhamento", "publicacao", "apresentacao_resultados"],
  },
  planejamento: {
    label: "Planejamento",
    icon: "▤",
    tone: "blue",
    blurb: "Roteiro, pauta, referências e organização",
    workflow: "padrao",
    performance: false,
    // Curated subset for round 1; the full list comes in round 2.
    subtypes: ["roteiro", "briefing", "definicao_pauta", "busca_referencias", "checklist_gravacao", "copy_legenda", "organizacao_pastas"],
  },
  operacional: {
    label: "Operacional",
    icon: "⚙",
    tone: "neutral",
    blurb: "Tarefa interna, sem revisão/aprovação",
    workflow: "simples",
    performance: false,
  },
  checkpoint_comercial: {
    label: "Checkpoint Comercial",
    icon: "◈",
    tone: "green",
    blurb: "Marco do onboarding/relacionamento comercial com o cliente",
    workflow: "padrao",
    performance: false,
  },
};

export const SUBTYPE_LABEL: Record<string, string> = {
  // agendamento
  visita_comercial: "Visita comercial",
  reuniao_alinhamento: "Reunião de alinhamento",
  publicacao: "Publicação",
  apresentacao_resultados: "Apresentação de resultados",
  // planejamento (+ gravacao is shared as a subtype label below)
  briefing: "Briefing",
  definicao_pauta: "Definição de pauta",
  busca_referencias: "Busca de referências",
  checklist_gravacao: "Checklist de gravação",
  copy_legenda: "Copy / legenda",
  organizacao_pastas: "Organização de pastas",
  // canonical specializations
  roteiro: "Roteiro",
  gravacao: "Gravação",
};

export const TASK_KIND_KEYS = Object.keys(TASK_KINDS) as TaskKind[];

/** Compatibility at the read boundary while old rows are being migrated.
 * Legacy classifications never become selectable kinds again. */
export function canonicalTaskClassification(kind: string, subtype?: string | null): { kind: TaskKind; subtype: string | null } {
  if (kind === "publicacao_recorrente") return { kind: "criativo", subtype: subtype ?? null };
  if (kind === "roteiro") return { kind: "planejamento", subtype: subtype ?? "roteiro" };
  if (kind === "gravacao") return { kind: "agendamento", subtype: subtype ?? "gravacao" };
  return { kind: isTaskKind(kind) ? kind : "operacional", subtype: subtype ?? null };
}

export function isTaskKind(x: string): x is TaskKind {
  return x in TASK_KINDS;
}
export function kindDef(kind: string): KindDef {
  return TASK_KINDS[canonicalTaskClassification(kind).kind];
}
export const kindLabel = (kind: string) => kindDef(kind).label;
export const kindTone = (kind: string) => kindDef(kind).tone;
export const kindIcon = (kind: string) => kindDef(kind).icon;
export const subtypeLabel = (subtype: string | null | undefined) =>
  subtype ? SUBTYPE_LABEL[subtype] ?? subtype : "";

// ---- Workflows / progress -----------------------------------------------------

// Explicit progress percentage per Kanban status, by workflow. Replaces the old
// hand-typed payload.pct and the STATUS_PCT map. "Concluído" column = status
// `aprovado`; "Publicado" column = status `concluido` (only publishable kinds
// reach it). requires_review / requires_approval are routing flags used by the
// board/modal — they don't re-scale these percentages.
export const WORKFLOWS: Record<WorkflowKey, Partial<Record<TaskStatus, number>>> = {
  padrao: { backlog: 0, em_producao: 35, revisao: 60, aprovacao: 80, aprovado: 100, concluido: 100 },
  criativo_pub: { backlog: 0, em_producao: 30, revisao: 55, aprovacao: 75, aprovado: 90, concluido: 100 },
  simples: { backlog: 0, em_producao: 60, aprovado: 100, concluido: 100 },
};

function workflowPct(workflow: WorkflowKey, status: TaskStatus): number {
  const wf = WORKFLOWS[workflow];
  if (wf[status] != null) return wf[status]!;
  // Status not explicitly in this workflow (e.g. an operacional card that somehow
  // sits in a skipped stage): fall back to the nearest defined status at or below.
  const idx = TASK_STATUSES.indexOf(status);
  for (let i = idx; i >= 0; i--) {
    const v = wf[TASK_STATUSES[i]];
    if (v != null) return v;
  }
  return 0;
}

type ProgressTask = Pick<TaskRecord, "kind" | "status" | "progress_weight"> & { recurrence_cadence?: TaskRecord["recurrence_cadence"] };

/**
 * Single source of truth for a card's progress (0–100).
 * - Plan cards (isPlan): weighted rollup of their member tasks.
 * - Everything else: the workflow percentage for the card's current status.
 * Pass `members` (tasks whose plan_id === this card's id) for plan rollups.
 */
export function taskProgress(task: ProgressTask, members: ProgressTask[] = []): number {
  const def = kindDef(task.kind);
  if (def.isPlan || task.recurrence_cadence) {
    if (members.length === 0) return 0;
    const totalWeight = members.reduce((s, m) => s + (m.progress_weight || 1), 0);
    if (totalWeight === 0) return 0;
    const weighted = members.reduce((s, m) => s + taskProgress(m) * (m.progress_weight || 1), 0);
    return Math.round(weighted / totalWeight);
  }
  return workflowPct(def.workflow, task.status);
}

/**
 * Onboarding progress for a client = average taskProgress() across their
 * checkpoint_comercial cards. Empty list (no checkpoints provisioned yet) is 0.
 */
export function checkpointsProgress(checkpoints: ProgressTask[]): number {
  if (checkpoints.length === 0) return 0;
  const sum = checkpoints.reduce((s, c) => s + taskProgress(c), 0);
  return Math.round(sum / checkpoints.length);
}
