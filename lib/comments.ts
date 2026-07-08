// Shared helpers for the `payload.comments` thread stored on `tasks` — used
// by the admin Kanban (TaskModal/TaskDetailPanel) and the client portal
// (Feedbacks page) alike, so both read the exact same shape.

export type TaskComment = { author: string; text: string; at: string };

export function commentsOf(payload: Record<string, unknown> | null | undefined): TaskComment[] {
  const comments = (payload ?? {}).comments;
  return Array.isArray(comments) ? (comments as TaskComment[]) : [];
}

const URL_RE = /https?:\/\/[^\s)]+/i;

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
