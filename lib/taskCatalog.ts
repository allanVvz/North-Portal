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
  // Kept out of the "Tipo" dropdown when creating a card. `criativo` is hidden
  // because a creative is no longer a card you make by hand — it's a FLOW you
  // instantiate (Roteiro → Captação → Edição → Publicação), and the kind
  // survives only as the internal family those four steps belong to.
  hidden?: boolean;
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
    blurb: "Etapas de uma peça: roteiro, captação, edição e publicação",
    workflow: "criativo_pub",
    performance: true,
    hidden: true,
    subtypes: ["roteiro", "captacao", "edicao", "publicacao"],
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
    subtypes: ["relatorio_trafego"],
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
  // criativo flow steps. `captacao` is deliberately NOT an alias of
  // `gravacao`: an agendamento/gravacao is a standalone shoot on the calendar,
  // while criativo/captacao is step 2 of a specific piece's flow.
  captacao: "Captação",
  edicao: "Edição",
  // operacional
  relatorio_trafego: "Relatório de tráfego",
};

export const TASK_KIND_KEYS = Object.keys(TASK_KINDS) as TaskKind[];

/** Kinds offered in the "Tipo" dropdown. Hidden kinds still exist, still
 * render, and still carry live data — they just aren't something you pick. */
export const CREATABLE_TASK_KIND_KEYS = TASK_KIND_KEYS.filter((key) => !TASK_KINDS[key].hidden);

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

type ProgressTask = Pick<TaskRecord, "kind" | "status" | "progress_weight"> & {
  id?: string;
  recurrence_cadence?: TaskRecord["recurrence_cadence"];
  payload?: TaskRecord["payload"];
};

/** Key an automation writes into payload when it halts a card into `parada`,
 * so progress can stay frozen at its pre-halt value instead of falling
 * through to whatever workflowPct's index-based fallback would pick (wrong,
 * since `parada` sits last in TASK_STATUSES). See lib/automations/errorHandling.ts. */
export const PRE_PARADA_STATUS_KEY = "pre_parada_status";

/** Snapshot of the flow template taken when a delivery card is created.
 *
 * A cascading flow materializes one step at a time, so at any moment most of
 * its steps DON'T EXIST YET as rows. Dividing by the weight of the members that
 * happen to exist is the trap: with only Roteiro created and done, a delivery
 * would report 100% while nothing has been shot, edited or published. The
 * denominator has to come from the mold.
 *
 * It lives on the card rather than being read from task_flow_templates so
 * taskProgress stays pure and synchronous — its four call sites each assemble
 * `members` differently and none of them can await a query. Freezing it is also
 * the correct semantics: editing a template must not silently rewrite the
 * progress of deliveries already in flight. */
export const FLOW_TOTAL_WEIGHT_KEY = "flow_total_weight";
export const FLOW_STEP_COUNT_KEY = "flow_step_count";

function flowTotalWeight(task: ProgressTask): number {
  const value = task.payload?.[FLOW_TOTAL_WEIGHT_KEY];
  return typeof value === "number" && value > 0 ? value : 0;
}

/** A card that aggregates children instead of holding a status of its own.
 * A entrega é reconhecida pela marca no payload, não pelo tipo — ver
 * FLOW_PARENT_KEY em lib/taskRelations.ts. */
function isRollupParent(task: ProgressTask): boolean {
  return Boolean(kindDef(task.kind).isPlan || task.recurrence_cadence || task.payload?.flow_parent === true);
}

/**
 * Single source of truth for a card's progress (0–100).
 * - Plan cards (isPlan), recurrence parents and flow deliveries: weighted
 *   rollup of their children. A delivery divides by the template snapshot
 *   (FLOW_TOTAL_WEIGHT_KEY) so steps not materialized yet still count against
 *   it; the others divide by the weight of the members they actually have.
 * - `parada` (automation halted the card): frozen at the percentage of
 *   whatever status it was in right before halting (payload.pre_parada_status).
 * - Everything else: the workflow percentage for the card's current status.
 * Pass `members` (tasks whose plan_id === this card's id) for plan rollups.
 * Pass `membersByParent` too when a member can itself be a parent — a delivery
 * inside a Plano de Ação, say. Without it a nested parent is asked for its own
 * progress with no children in hand and honestly answers 0, dragging the outer
 * average down. Callers that never nest can keep omitting it.
 */
export function taskProgress(
  task: ProgressTask,
  members: ProgressTask[] = [],
  membersByParent?: ReadonlyMap<string, ProgressTask[]>,
): number {
  return progressOf(task, members, membersByParent, new Set());
}

function rollupProgress(
  task: ProgressTask,
  members: ProgressTask[],
  membersByParent: ReadonlyMap<string, ProgressTask[]> | undefined,
  seen: Set<string>,
): number {
  const memberWeight = members.reduce((s, m) => s + (m.progress_weight || 1), 0);
  const totalWeight = flowTotalWeight(task) || memberWeight;
  if (totalWeight === 0) return 0;
  const weighted = members.reduce(
    (s, m) => s + progressOf(m, membersByParent?.get(m.id ?? "") ?? [], membersByParent, seen) * (m.progress_weight || 1),
    0,
  );
  return Math.round(weighted / totalWeight);
}

function progressOf(
  task: ProgressTask,
  members: ProgressTask[],
  membersByParent: ReadonlyMap<string, ProgressTask[]> | undefined,
  seen: Set<string>,
): number {
  const def = kindDef(task.kind);
  if (isRollupParent(task)) {
    // A malformed graph (a plan that ends up its own descendant) must not blow
    // the stack. Revisiting a card mid-walk means the cycle contributes nothing.
    if (task.id && seen.has(task.id)) return 0;
    if (task.id) seen.add(task.id);
    return rollupProgress(task, members, membersByParent, seen);
  }
  if (task.status === "parada") {
    const frozen = task.payload?.[PRE_PARADA_STATUS_KEY];
    if (typeof frozen === "string" && (TASK_STATUSES as readonly string[]).includes(frozen)) {
      return workflowPct(def.workflow, frozen as TaskStatus);
    }
    return 0;
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
