// In-code catalog for the task/Kanban model (v2). The `kind`/`subtype` columns
// on `tasks` are free TEXT; this file is the single source of truth for the
// vocabulary (which kinds/subtypes exist, their labels, icons, tones), the
// the progress calculation. Adding a kind or tweaking a stage percentage is a
// code change here — no DB migration needed. Kept as a
// one-way dependency on lib/validation (status list + TaskRecord type) so
// validation never has to import back.

import { TASK_STATUSES, type TaskRecord, type TaskStatus } from "@/lib/validation";
import { RECURRENCE_GROUP_KEY } from "@/lib/recurrenceState";
import { flowStepPct } from "@/lib/flows/flowProgress";
import { getLiveKindDef } from "@/lib/taskCatalog/liveKinds";

// ---- Kinds --------------------------------------------------------------------

export type TaskKind =
  | "operacional"
  | "plano_acao"
  | "criativo"
  | "automacao"
  | "checkpoint_comercial";

export type KindDef = {
  label: string;
  icon: string;
  tone: "green" | "gold" | "blue" | "purple" | "neutral";
  blurb: string;
  performance: boolean; // eligible to hold task_metrics + show in Performance
  isPlan?: boolean; // aggregates member tasks; progress is a rollup
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
    icon: "☑",
    tone: "green",
    blurb: "Agrega tarefas, datas e progresso do conjunto",
    performance: true,
    isPlan: true,
  },
  criativo: {
    // "▸" é o ícone GENÉRICO da Entrega — pra quando o formato de publicação
    // (reels/story/carrossel/anúncio/banner) ainda não está definido. Uma vez
    // que o subtype da etapa de publicação define o formato, `TaskKindIcon`
    // troca esse ícone pelo de SUBTYPE_ICON (mais específico), sem precisar
    // de nenhuma condição aqui.
    label: "Entrega",
    icon: "▸",
    tone: "purple",
    blurb: "Entrega versionada; as etapas pertencem ao workflow persistido",
    performance: true,
  },
  checkpoint_comercial: {
    label: "Checkpoint",
    icon: "◈",
    tone: "green",
    blurb: "Marco do onboarding/relacionamento comercial com o cliente",
    performance: false,
  },
  automacao: {
    label: "Automação",
    icon: "⚡",
    tone: "purple",
    blurb: "Entrega automatizada; as etapas pertencem ao workflow persistido",
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
  // Subtipos executáveis de Tarefa. `captacao` is deliberately NOT an alias of
  // `gravacao`: a gravação pode ser avulsa no calendário, enquanto Captação
  // é uma tarefa que pode ocupar uma etapa de workflow.
  captacao: "Captação",
  edicao: "Edição",
  // Tarefas de automação
  relatorio_anuncios: "Relatório de anúncios",
  feedback: "Feedback",
  relatorio_conversao: "Relatório de conversão",
  relatorio_trafego: "Relatório de anúncios",
  agendamentos: "Agendamentos",
  // Formatos de publicação — antes só existiam informalmente como rótulo do
  // contador de quantidade em app/admin/contentPlan.ts (gerava tarefa
  // kind=operacional genérica, sem subtype próprio). Agora são subtypes de
  // verdade: servem tanto pra uma etapa comum ("Publicação — Reels") quanto
  // pra classificar a própria Entrega ("Entrega tipo Reels").
  reels: "Reels",
  story: "Story",
  carrossel: "Carrossel",
  anuncio: "Anúncio",
  banner: "Banner",
};

/** Ícone por SUBTYPE — a maioria dos subtypes não tem um (herdam o do kind,
 *  ver `TaskKindIcon`); só os formatos de publicação abaixo ganharam ícone
 *  próprio até agora, porque são a categoria onde "qual card é este, de
 *  relance" mais importa numa lista longa de etapas. Ausente aqui != erro —
 *  é o comportamento padrão pra todo o resto do vocabulário. */
export const SUBTYPE_ICON: Partial<Record<string, string>> = {
  reels: "▶",
  story: "◔",
  carrossel: "▦",
  anuncio: "◎",
  banner: "▬",
};
export const subtypeIcon = (subtype: string | null | undefined): string | null =>
  (subtype && SUBTYPE_ICON[subtype]) || null;

export function publicationFormatSubtype(format: unknown): string | null {
  if (typeof format !== "string") return null;
  const normalized = format.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return normalized === "reel" || normalized === "reels" ? "reels"
    : normalized === "stories" || normalized === "story" ? "story"
    : normalized === "carrossel" ? "carrossel"
    : normalized === "anuncio" ? "anuncio"
    : normalized === "banner" ? "banner" : null;
}

export const TASK_KIND_KEYS = Object.keys(TASK_KINDS) as TaskKind[];

/** The database is already on the canonical FK catalog. Unknown values pass
 * through untouched so a corrupt row stays visible for repair instead of
 * being silently rewritten as another type by the UI. */
export function canonicalTaskClassification(kind: string, subtype?: string | null): { kind: string; subtype: string | null } {
  return { kind, subtype: subtype ?? null };
}

export function isTaskKind(x: string): x is TaskKind {
  return x in TASK_KINDS;
}

/** Sem ícone/tom/rótulo próprio — nem nos 5 tipos embutidos, nem no cache ao
 * vivo (ainda não carregou, ou o tipo não tem icon/tone gravado). Tom neutro,
 * nunca aparece em Performance até a identidade real chegar. */
const FALLBACK_KIND_DEF: KindDef = { label: "Tarefa", icon: "●", tone: "neutral", blurb: "", performance: false };

export function kindDef(kind: string): KindDef {
  const canonical = canonicalTaskClassification(kind).kind;
  if (isTaskKind(canonical)) return TASK_KINDS[canonical];
  return getLiveKindDef(canonical) ?? FALLBACK_KIND_DEF;
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
//
// `backlog: 0` continua valendo aqui de propósito, mesmo depois de P1-C
// (progresso por "casas" dentro de um fluxo) ter feito uma etapa de fluxo
// contar uma casa só por existir. Essa régua nova é do FLUXO, não deste mapa
// global — mora em lib/flows/flowProgress.ts e só é usada dentro do rollup de
// uma entrega (ver flowMemberPct em rollupProgress, abaixo). Mudar o 0 aqui
// regrediria toda tela que chama taskProgress FORA de um fluxo: uma Tarefa
// comum ou um Checkpoint em Entrada não fez trabalho nenhum, então continuam
// em 0% — só uma etapa de entrega tem a garantia de que "existir" já significa
// que a etapa anterior foi aprovada.
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
  workflow_version_id?: TaskRecord["workflow_version_id"];
  workflow_version?: TaskRecord["workflow_version"];
  // Só lidas dentro de um rollup de ENTREGA (ver flowMemberPct) — a régua de
  // casas do fluxo depende delas. Opcionais para não quebrar os dezenas de
  // call sites que montam um ProgressTask sem pensar em fluxo; ausentes,
  // valem como falsy (regra "nenhuma das duas" = 3 casas).
  requires_review?: TaskRecord["requires_review"];
  requires_approval?: TaskRecord["requires_approval"];
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
function flowTotalWeight(task: ProgressTask): number {
  // Um TEMPLATE de recorrência de entrega carrega as marcas de fluxo, porque é
  // delas que cada ocorrência herda o próprio molde. Mas o template não é uma
  // entrega: os filhos dele são as OCORRÊNCIAS, não as etapas. Se ele dividisse
  // pelo peso congelado do molde, a quinta ocorrência levaria a rotina a mais
  // de 100%. O denominador dele são os próprios filhos, como em qualquer
  // recorrência — e é isso que o zero aqui devolve.
  if (task.payload?.[RECURRENCE_GROUP_KEY] === true) return 0;
  return task.workflow_version?.workflow_version_steps.reduce(
    (total, step) => total + (Number(step.progress_weight) || 1),
    0,
  ) ?? 0;
}

/** A card that aggregates children instead of holding a status of its own.
 * A entrega é reconhecida pela FK da versão de workflow. */
export function isRollupParent(task: ProgressTask): boolean {
  return Boolean(kindDef(task.kind).isPlan || task.recurrence_cadence || task.workflow_version_id);
}

/**
 * Single source of truth for a card's progress (0–100).
 * - Plan cards (isPlan), recurrence parents and flow deliveries: weighted
 *   rollup of their children. A delivery divides by its pinned workflow version
 *   so steps not materialized yet still count against
 *   it; the others divide by the weight of the members they actually have.
 *   Dentro de uma entrega, cada etapa-membro entra na média pela régua de
 *   "casas" de lib/flows/flowProgress.ts (flowMemberPct), não pelo statusPct
 *   comum — é o que faz uma etapa recém-nascida em Entrada já valer alguma
 *   coisa (a etapa anterior foi aprovada), sem tocar no statusPct global que
 *   as outras telas usam.
 * - `parada` (automation halted the card): frozen at the percentage of
 *   whatever status it was in right before halting (payload.pre_parada_status).
 * - Everything else (Tarefa comum, Checkpoint, membro solto de Plano):
 *   the percentage for the card's current status, via STATUS_PCT — inalterado.
 * Pass `members` (tasks whose plan_id === this card's id) for plan rollups.
 * Pass `membersByParent` too when a member can itself be a parent — a delivery
 * inside a Plano de Ação, say. Without it a nested parent is asked for its own
 * progress with no children in hand and honestly answers 0, dragging the outer
 * average down. Callers that never nest can keep omitting it.
 */
/** Membros de um Plano que devem CONTAR no progresso dele.
 *
 * Uma Entrega dentro de um Plano vale UM item, pelo progresso já rolado dela —
 * que é a média ponderada das próprias etapas. Se alguém ligar também as etapas
 * ao mesmo Plano, a peça passaria a pesar cinco vezes na média. Esta função é
 * onde essa regra vive: membro que já é etapa de outra Entrega presente na
 * mesma lista sai da contagem.
 *
 * Ele continua aparecendo na tela como atividade — o que muda é só o peso. */
export function dedupePlanMembers<T extends { id: string; workflow_version_id?: string | null }>(
  members: readonly T[],
  membersByParent: ReadonlyMap<string, { id: string }[]> | undefined,
): T[] {
  if (!membersByParent) return [...members];
  const stepIds = new Set<string>();
  for (const member of members) {
    if (!member.workflow_version_id) continue;
    for (const step of membersByParent.get(member.id) ?? []) stepIds.add(step.id);
  }
  return members.filter((member) => !stepIds.has(member.id));
}

export function taskProgress(
  task: ProgressTask,
  members: ProgressTask[] = [],
  membersByParent?: ReadonlyMap<string, ProgressTask[]>,
): number {
  return progressOf(task, members, membersByParent, new Set());
}

/** Percentual (0–100) de UMA etapa de fluxo, na régua de casas que vale para
 * ela (lib/flows/flowProgress.ts). É o "statusPct de dentro de um fluxo": o
 * número que entra na média ponderada por progress_weight no lugar do
 * statusPct comum — mesma forma, régua diferente.
 *
 * `parada` segue a mesma regra congelada de fora do fluxo: se a automação
 * anotou de onde o card veio (PRE_PARADA_STATUS_KEY), a etapa fica travada
 * naquele degrau da SUA PRÓPRIA régua; sem a anotação, 0 — mesma rede de
 * segurança do caminho comum, para não inventar progresso de um dado incompleto. */
function flowMemberPct(task: ProgressTask): number {
  const flags = { requires_review: task.requires_review, requires_approval: task.requires_approval };
  if (task.status === "parada") {
    const frozen = task.payload?.[PRE_PARADA_STATUS_KEY];
    if (typeof frozen === "string" && (TASK_STATUSES as readonly string[]).includes(frozen)) {
      return flowStepPct(frozen as TaskStatus, flags);
    }
    return 0;
  }
  return flowStepPct(task.status, flags);
}

function rollupProgress(
  task: ProgressTask,
  members: ProgressTask[],
  membersByParent: ReadonlyMap<string, ProgressTask[]> | undefined,
  seen: Set<string>,
): number {
  const memberWeight = members.reduce((s, m) => s + (m.progress_weight || 1), 0);
  const totalWeight = flowTotalWeight(task) || memberWeight;
  // Um rollup parent SEM filhos (ex.: uma execução de recorrência cujo molde
  // é um Plano de Ação, mas que nunca ganhou atividades próprias) não pode
  // ficar preso em 0% só por não ter nada pra somar — sem isto, um card
  // marcado "aprovado" à mão (a régua que "REUNIÃO ROTINA" realmente usa)
  // contava 0% pra sempre na média do pai, mesmo concluído. Com filhos de
  // verdade, o rollup continua sendo a única fonte (comentário abaixo).
  if (totalWeight === 0) return leafStatusPct(task);
  // Só uma ENTREGA aplica a régua de casas aos próprios membros — Plano de
  // Ação e pai de recorrência continuam com a média ponderada por statusPct
  // comum (via progressOf), porque os membros deles não são etapas de um
  // funil único: são atividades soltas ou ocorrências inteiras, cada uma já
  // dona do próprio progresso. Um membro que É ele mesmo um pai (a entrega
  // dentro de um Plano, a ocorrência dentro do molde recorrente) também cai
  // no caminho antigo — a régua de casas só faz sentido para uma etapa FOLHA,
  // com status próprio, não para um rollup que já devolve 0–100 sozinho.
  const isFlow = Boolean(task.workflow_version_id);
  const weighted = members.reduce((s, m) => {
    const pct = isFlow && !isRollupParent(m)
      ? flowMemberPct(m)
      : progressOf(m, membersByParent?.get(m.id ?? "") ?? [], membersByParent, seen);
    return s + pct * (m.progress_weight || 1);
  }, 0);
  return Math.round(weighted / totalWeight);
}

/** O percentual de um card FOLHA — seu próprio status, `parada` congelado no
 * degrau de antes de parar. Extraído para `rollupProgress` também poder usar
 * isto como fallback quando um rollup parent não tem filhos: sem filhos pra
 * somar, o próprio status já é a melhor resposta disponível. */
function leafStatusPct(task: ProgressTask): number {
  if (task.status === "parada") {
    const frozen = task.payload?.[PRE_PARADA_STATUS_KEY];
    if (typeof frozen === "string" && (TASK_STATUSES as readonly string[]).includes(frozen)) {
      return statusPct(frozen as TaskStatus);
    }
    return 0;
  }
  return statusPct(task.status);
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
  return leafStatusPct(task);
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
