// Shared helpers for the `payload.comments` thread stored on `tasks` — used
// by the admin Kanban (TaskModal/TaskDetailPanel) and the client portal
// (Feedbacks page) alike, so both read the exact same shape.

export type TaskComment = { author: string; text: string; at: string; edited_at?: string };

export function commentsOf(payload: Record<string, unknown> | null | undefined): TaskComment[] {
  const comments = (payload ?? {}).comments;
  return Array.isArray(comments) ? (comments as TaskComment[]) : [];
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
