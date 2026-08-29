// In-code catalog for the task/Kanban model (v2). The `kind`/`subtype` columns
// on `tasks` are free TEXT; this file is the single source of truth for the
// vocabulary (which kinds/subtypes exist, their labels, icons, tones), the
// the progress calculation. Adding a kind or tweaking a stage percentage is a
// code change here — no DB migration needed. Kept as a
// one-way dependency on lib/validation (status list + TaskRecord type) so
// validation never has to import back.

import { TASK_STATUSES, type TaskRecord, type TaskStatus } from "@/lib/validation";

// ---- Kinds --------------------------------------------------------------------

export type TaskKind =
  | "operacional"
  | "plano_acao"
  | "criativo"
  | "checkpoint_comercial";

export type KindDef = {
  label: string;
  icon: string;
  tone: "green" | "gold" | "blue" | "purple" | "neutral";
  blurb: string;
  performance: boolean; // eligible to hold task_metrics + show in Performance
  isPlan?: boolean; // aggregates member tasks; progress is a rollup
  subtypes?: string[]; // subtype keys (labels in SUBTYPE_LABEL)
};

// Quatro tipos, e o mesmo funil para todos.
//
// Antes eram seis, e a relação entre tipo e comportamento era acidental:
// `agendamento` e `planejamento` existiam só para carregar subtipos, sem
// nenhuma regra própria, enquanto `criativo` carregava sozinho a etapa
// "Publicado" e um workflow inteiro só para ela. O vocabulário aqui passa a
// ser o mesmo que a tela já falava — Tarefas, Planos, Entregas — mais o
// Checkpoint, que nasce do onboarding.
//
// "Rotina" NÃO mora aqui. Recorrência é a coluna `recurrence_cadence`,
// ortogonal ao tipo, e é justamente isso que permite uma ENTREGA recorrente:
// um `kind: "rotina"` tornaria a combinação impossível de representar. Na
// criação ela aparece como uma quinta porta (ver TaskModal), não como kind.
export const TASK_KINDS: Record<TaskKind, KindDef> = {
  operacional: {
    label: "Tarefa",
    icon: "⚙",
    tone: "neutral",
    blurb: "O trabalho do dia a dia. Sem subtipo",
    performance: false,
  },
  plano_acao: {
    label: "Plano",
    icon: "◆",
    tone: "green",
    blurb: "Agrega tarefas, datas e progresso do conjunto",
    performance: true,
    isPlan: true,
  },
  criativo: {
    label: "Entrega",
    icon: "✦",
    tone: "purple",
    blurb: "Uma corrente de etapas: roteiro, captação, edição e publicação",
    performance: true,
    subtypes: ["roteiro", "captacao", "edicao", "publicacao"],
  },
  checkpoint_comercial: {
    label: "Checkpoint",
    icon: "◈",
    tone: "green",
    blurb: "Marco do onboarding/relacionamento comercial com o cliente",
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

/** Compatibility at the read boundary while old rows are being migrated.
 * Legacy classifications never become selectable kinds again.
 *
 * `agendamento` e `planejamento` entram aqui porque deixaram de ser tipos: a
 * migração zera o kind das linhas, mas esta função é o que segura a tela entre
 * o deploy e a migração, e o que impede um card antigo de renderizar cru se
 * alguma linha escapar. O fallback final para `operacional` é a mesma rede —
 * com o vocabulário encolhendo, é ele que separa uma linha velha de um crash. */
export function canonicalTaskClassification(kind: string, subtype?: string | null): { kind: TaskKind; subtype: string | null } {
  if (kind === "publicacao_recorrente") return { kind: "criativo", subtype: subtype ?? null };
  if (kind === "roteiro") return { kind: "operacional", subtype: subtype ?? "roteiro" };
  if (kind === "gravacao") return { kind: "operacional", subtype: subtype ?? "gravacao" };
  if (kind === "agendamento" || kind === "planejamento") return { kind: "operacional", subtype: subtype ?? null };
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

// Um funil só, para todo tipo de card.
//
// Existiam três workflows. O `criativo_pub` era inteiro por causa de uma etapa:
// ele dava 90% ao `aprovado` para deixar os 100% reservados ao "Publicado", que
// só o Criativo alcançava. Com Publicado fora do funil — publicar é a última
// ETAPA de uma Entrega, não um status — a razão de existir dos três sumiu, e o
// `simples`, que só mudava o 35 para 60, era divergência sem regra por trás.
//
// Consequência assumida: card de Tarefa em "Em produção" vai de 60% para 35%,
// e Entrega concluída vai de 90% para 100%.
export const STATUS_PCT: Partial<Record<TaskStatus, number>> = {
  backlog: 0,
  em_producao: 35,
  revisao: 60,
  aprovacao: 80,
  aprovado: 100,
};

function statusPct(status: TaskStatus): number {
  const direct = STATUS_PCT[status];
  if (direct != null) return direct;
  // Status fora do mapa (`parada`, ou uma linha antiga em `concluido` antes da
  // migração): cai no vizinho definido mais próximo abaixo.
  const idx = TASK_STATUSES.indexOf(status);
  for (let i = idx; i >= 0; i--) {
    const v = STATUS_PCT[TASK_STATUSES[i]];
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
 * through to whatever statusPct's index-based fallback would pick (wrong,
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
 * - Everything else: the percentage for the card's current status.
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
      return statusPct(frozen as TaskStatus);
    }
    return 0;
  }
  return statusPct(task.status);
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
