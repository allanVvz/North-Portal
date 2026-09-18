// Shared helpers for the `payload.comments` thread stored on `tasks` — used
// by the admin Kanban (TaskModal/TaskDetailPanel) and the client portal
// (Feedbacks page) alike, so both read the exact same shape.

import { kindDef } from "./taskCatalog";
import { isRecurrenceTemplate } from "./recurrenceState";
import { actionPlanMembersOf, flowStepsOf, isFlowDelivery, recurrenceExecutionsOf, recurrenceParentIdOf } from "./taskRelations";
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

/** O molde de recorrência a que o card pertence (ele mesmo, se for o molde). */
function recurrenceTemplateIdOf(task: Pick<FamilyMember, "id" | "payload" | "recurrence_cadence">): string | null {
  if (isRecurrenceTemplate(task)) return task.id;
  return recurrenceParentIdOf(task);
}

/** Este card mostra o thread da FAMÍLIA, ou só o próprio?
 *
 * Um Plano de Ação mostra ele + as atividades, uma entrega mostra ela + as
 * etapas — o card filho de plano/entrega mostra só os próprios comentários,
 * senão a mesma conversa apareceria duplicada dos dois lados.
 *
 * Recorrência SOMA o histórico inteiro (ATA 14/09): o molde e todos os ciclos
 * mostram a mesma conversa, de qualquer ciclo que se abra. Uma rotina é uma
 * demanda só que se repete, e o que se falou no ciclo passado é contexto do
 * ciclo de agora. (Até 14/09 a recorrência ficava de fora por ser "ruído".)
 * Uma entrega-ocorrência de fluxo recorrente continua juntando as etapas dela,
 * porque a regra de entrega vem antes.
 *
 * `kind` separado do card para a tela de edição poder perguntar pelo tipo que
 * está no formulário, ainda não salvo. */
export function isFamilyParent(task: Pick<FamilyMember, "id" | "kind" | "payload" | "recurrence_cadence">, kind = task.kind): boolean {
  return Boolean(kindDef(kind).isPlan || isFlowDelivery(task) || recurrenceTemplateIdOf(task));
}

/** Os cards cujo thread aparece junto neste: ele mesmo e a família. Sempre
 *  começa pelo próprio card, e nunca repete um id.
 *
 *  Ordem de prioridade, de propósito, um card só cai numa categoria:
 *  1. O card É O MOLDE de uma recorrência (`isRecurrenceTemplate`) → os
 *     ciclos, sempre — mesmo quando o molde também carrega marcas herdadas
 *     de fluxo (entrega recorrente) ou é ele mesmo um Plano de Ação (ex.
 *     "REUNIÃO ROTINA - ALLAN"): o molde em si nunca tem etapa nem
 *     atividade PRÓPRIA, só ciclos. Isto vem ANTES de entrega/plano de
 *     propósito — checar isFlowDelivery ou isPlan primeiro (como era) fazia
 *     vincular uma execução nova nunca aparecer no thread do molde, porque
 *     o merge nem olhava pra lista certa.
 *  2. Senão, é uma entrega DE VERDADE (uma ocorrência com etapas próprias)
 *     → as etapas — regra documentada em isFamilyParent.
 *  3. Senão, é uma OCORRÊNCIA de recorrência (aponta pra um molde) → o
 *     histórico cruzado de ciclos (ATA 14/09).
 *  4. Senão, é um Plano de Ação → as atividades. */
export function familyCardsOf<T extends FamilyMember>(task: T, tasks: readonly T[], kind = task.kind): T[] {
  if (!isFamilyParent(task, kind)) return [task];
  const templateId = isRecurrenceTemplate(task)
    ? task.id
    : isFlowDelivery(task)
      ? null
      : recurrenceParentIdOf(task);
  const members = templateId
    ? [...tasks.filter((t) => t.id === templateId), ...recurrenceExecutionsOf(templateId, tasks)]
    : isFlowDelivery(task)
      ? flowStepsOf(task.id, tasks)
      : kindDef(kind).isPlan
        ? actionPlanMembersOf(task.id, tasks)
        : [];
  const seen = new Set([task.id]);
  const family = [task];
  for (const member of members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    family.push(member);
  }
  return family;
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
