// Shared helpers for the `payload.comments` thread stored on `tasks` — used
// by the admin Kanban (TaskModal/TaskDetailPanel) and the client portal
// (Feedbacks page) alike, so both read the exact same shape.

import { kindDef } from "./taskCatalog";
import { isRecurrenceTemplate } from "./recurrenceState";
import { actionPlanMembersOf, flowStepsOf, isFlowDelivery, recurrenceExecutionsOf } from "./taskRelations";
import type { TaskRecord } from "./validation";

export type TaskComment = {
  /** Chave idempotente do comentário (gerada por quem envia). Reenviar o mesmo
   *  id não grava outro comentário — ver `append_task_comment_idempotent` e
   *  `automation_task_payload_update`. Ausente nos comentários antigos. */
  id?: string;
  /** Nome do autor, congelado no momento do comentário. Sempre presente — é
   *  ele que mantém o comentário legível depois que a conta é apagada, e é o
   *  único autor que um comentário de automação tem. */
  author: string;
  /** Id do perfil que escreveu, quando há um. Ausente em comentário de
   *  automação (não é pessoa) e nos escritos antes da migration
   *  20260827001000. Quando existe, é por ele que a foto do autor é resolvida
   *  — ver app/avatar/README.md. */
  author_id?: string;
  text: string;
  at: string;
  edited_at?: string;
};

export function commentsOf(payload: Record<string, unknown> | null | undefined): TaskComment[] {
  const comments = (payload ?? {}).comments;
  return Array.isArray(comments) ? (comments as TaskComment[]) : [];
}

/** Um comentário anotado com o card de onde veio — usado quando o thread de um
 *  card mostra a conversa da família inteira (plano + atividades, ou entrega +
 *  etapas). `taskId` ainda não é renderizado; o rótulo de origem por comentário
 *  é item de roadmap (R2.5). */
export type FamilyComment = TaskComment & { taskId: string };

/** Mescla os comentários de vários cards num só thread, em ordem cronológica.
 *
 *  `at` NÃO tem formato único: os comentários gravados pela RPC
 *  `append_task_comment` saem como `timestamptz::text` ("2026-08-24 11:43:00+00"
 *  — espaço, sem `T`, sem `Z`), enquanto os escritos por JS (automação, imports,
 *  comentários antigos) saem em ISO-8601 ("2026-08-24T11:43:00.000Z"). Comparar
 *  as duas formas como string (`localeCompare`) ordena por formato antes de por
 *  data — todo comentário de um formato vem antes de todo comentário do outro,
 *  e um comentário antigo do plano fica preso no topo. Por isso a comparação é
 *  sempre por timestamp parseado (o mesmo `new Date(at)` que o resto do módulo
 *  já usa). Empate ou data ilegível → mantém a ordem de inserção (sort estável).
 *
 *  Dentro de um card só a ordem de inserção já é cronológica; a diferença é
 *  entre cards. */
export function mergeFamilyComments(
  cards: ReadonlyArray<{ id: string; payload: Record<string, unknown> | null | undefined }>,
): FamilyComment[] {
  const time = (at: string) => {
    const ms = new Date(at).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };
  return cards
    .flatMap((card) => commentsOf(card.payload).map((comment) => ({ ...comment, taskId: card.id })))
    .sort((a, b) => time(a.at) - time(b.at));
}

/** O card mínimo que a regra de família precisa ler — classificação,
 * versão de workflow, recorrência e relações de parentesco. */
type FamilyMember = Pick<TaskRecord, "id" | "kind" | "payload" | "parents"> & {
  recurrence_cadence?: TaskRecord["recurrence_cadence"];
  workflow_version_id?: TaskRecord["workflow_version_id"];
};

/** Este card mostra o thread da FAMÍLIA, ou só o próprio?
 *
 * Um Plano de Ação mostra ele + as atividades, uma entrega mostra ela + as
 * etapas — o card filho de plano/entrega mostra só os próprios comentários,
 * senão a mesma conversa apareceria duplicada dos dois lados.
 *
 * Recorrência NÃO soma histórico entre ciclos-irmãos (revisto 2026-09-2x — a
 * regra antiga, da ATA 14/09, fazia abrir uma execução mostrar comentário de
 * OUTRA execução da mesma rotina, e duas execuções são irmãs, não a mesma
 * conversa). O molde continua mostrando os ciclos quando ABERTO ELE MESMO —
 * isso é o molde mostrando os próprios filhos, não um ciclo lendo o irmão.
 *
 * `kind` separado do card para a tela de edição poder perguntar pelo tipo que
 * está no formulário, ainda não salvo. */
export function isFamilyParent(task: Pick<FamilyMember, "id" | "kind" | "payload" | "recurrence_cadence">, kind = task.kind): boolean {
  return Boolean(kindDef(kind).isPlan || isFlowDelivery(task) || isRecurrenceTemplate(task));
}

/** Os cards cujo thread aparece junto neste: ele mesmo e TODA a árvore de
 *  descendentes — recursivo (revisto 2026-09-2x: Rotina → Plano → Entrega →
 *  Task mostra os 4 níveis juntos, não só 1 salto). Nunca repete um id
 *  (protege contra ciclo no grafo, embora o banco já recuse estrutura
 *  circular).
 *
 *  Em cada nó da árvore, na ordem abaixo (um nó pode cair em mais de uma,
 *  ex. um molde que também é Plano de Ação — soma os dois):
 *  1. O nó É O MOLDE de uma recorrência (`isRecurrenceTemplate`) → desce nos
 *     ciclos. O molde em si nunca tem etapa/atividade PRÓPRIA, só ciclos —
 *     por isso não soma com as regras 2/3 abaixo.
 *  2. Senão, é uma Entrega de fluxo (`isFlowDelivery`) → desce nas etapas.
 *  3. É um Plano de Ação (`kindDef(kind).isPlan`) → desce nos membros
 *     (`structural_member`). Uma ocorrência de recorrência que também é
 *     Plano (ex. "PLANO SEMANAL - ALLAN") cai só aqui — nunca lê os
 *     ciclos-irmãos do molde de que é ocorrência, só a própria árvore. */
export function familyCardsOf<T extends FamilyMember>(task: T, tasks: readonly T[], kind = task.kind): T[] {
  if (!isFamilyParent(task, kind)) return [task];
  const seen = new Set<string>();
  const family: T[] = [];
  collectFamily(task, kind, tasks, seen, family);
  return family;
}

function collectFamily<T extends FamilyMember>(node: T, nodeKind: string, tasks: readonly T[], seen: Set<string>, family: T[]): void {
  if (seen.has(node.id)) return;
  seen.add(node.id);
  family.push(node);
  if (isRecurrenceTemplate(node)) {
    for (const cycle of recurrenceExecutionsOf(node.id, tasks)) collectFamily(cycle, cycle.kind, tasks, seen, family);
    return;
  }
  if (isFlowDelivery(node)) {
    for (const step of flowStepsOf(node.id, tasks)) collectFamily(step, step.kind, tasks, seen, family);
    return;
  }
  if (kindDef(nodeKind).isPlan) {
    for (const member of actionPlanMembersOf(node.id, tasks)) collectFamily(member, member.kind, tasks, seen, family);
  }
}

/** O thread que um card mostra — a regra completa, em um lugar só.
 *
 * Existe porque a mescla morava dentro do TaskModal e mais nenhuma tela a
 * tinha: o painel lateral, o portal, Revisões e Aprovações liam `commentsOf`
 * cru. Abrir o MESMO card pelo modal ou pelo painel devolvia threads
 * diferentes, e como o link `?task=` cai no painel quando a preferência de
 * painel lateral está ligada, a regra parecia funcionar de forma intermitente.
 *
 * Todo comentário sai anotado com `taskId`, inclusive no caso do card filho —
 * assim quem renderiza pode marcar a origem sem precisar saber se houve mescla. */
export function familyThreadOf<T extends FamilyMember>(task: T, tasks: readonly T[], kind = task.kind): FamilyComment[] {
  return mergeFamilyComments(familyCardsOf(task, tasks, kind));
}

const URL_RE = /https?:\/\/[^\s)]+/gi;
// `[label](url)` — the short-link form both the automation (lib/automations/run.ts)
// and the manual "attach a document" comment button (TaskModal.tsx
// attachDocToComment) write, so a comment shows the file's own name instead
// of its full raw URL. A bare https?://... (pasted by hand, or from an older
// comment written before this existed) still matches too, falling back to
// showing the raw URL as before.
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/gi;

/** The most recent link pasted into any comment — this is what "abrir card" /
 *  "ver material" points to now, replacing the old static per-client Drive
 *  link: whoever posts a fresh link in a comment updates what the client sees. */
export function extractLatestLink(comments: TaskComment[]): string | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const match = comments[i].text.match(URL_RE);
    if (match) return match[0];
  }
  return null;
}

/** Splits comment text into plain-text and link segments so callers can
 *  render pasted/generated links as clickable `<a>` tags without each
 *  duplicating the regex. A link segment carries `label` when the source
 *  text used the short `[label](url)` form — callers show that instead of
 *  the raw `url` when present. */
export function splitCommentText(text: string): Array<{ text: string } | { url: string; label?: string }> {
  const parts: Array<{ text: string } | { url: string; label?: string }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: text.slice(lastIndex, index) });
    const [, label, labeledUrl, bareUrl] = match;
    parts.push(label && labeledUrl ? { url: labeledUrl, label } : { url: bareUrl });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  return parts;
}

const DAY_MS = 86400000;

/** Idade de um card, sempre relativa e sempre curta ("há 3 d", "há 5 sem").
 *
 *  Diferente de formatCommentTime de propósito. Num comentário a data exata
 *  importa — é um registro, e "há 12 dias" seria vago. Num card do quadro a
 *  última atualização é só um sinal de frescor, e ali `28/08/2026 22:02`
 *  gastava a linha inteira competindo em precisão com o PRAZO, que é a data
 *  que a pessoa está lendo o quadro para descobrir. Dois carimbos por card, e
 *  o menos útil era o mais preciso. */
export function formatRelativeAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  if (diff < 60_000) return "agora";
  const minutos = Math.floor(diff / 60_000);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(diff / 3.6e6);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(diff / DAY_MS);
  if (dias < 7) return `há ${dias} d`;
  const semanas = Math.floor(dias / 7);
  if (semanas < 9) return `há ${semanas} sem`;
  return `há ${Math.floor(dias / 30)} m`;
}

/** Comment publish time: relative for the first 24h ("agora" / "há X min" /
 *  "há X h"), then an absolute pt-BR date/time past that — so an old comment
 *  never reads as a vague "há 12 dias". */
export function formatCommentTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diff = now - then;
  if (diff < DAY_MS) {
    if (diff < 60000) return "agora";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `há ${minutes} min`;
    return `há ${Math.floor(diff / 3.6e6)} h`;
  }
  return formatAbsoluteTime(iso);
}

/** Data e hora absolutas em pt-BR ("24/08/2026 11:43"). Usada onde o relativo
 *  não serve — a linha "Criado em" do card, que é um carimbo, não um "agora". */
export function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}
