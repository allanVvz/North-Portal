import { commentsOf } from "./comments";
import { isRecurrenceTemplate } from "./recurrenceState";
import type { TaskRecord } from "./validation";

export type ConversationTask = Pick<TaskRecord,
  "id" | "client_id" | "kind" | "subtype" | "title" | "payload" | "plan_id" |
  "recurrence_cadence" | "due_date" | "workflow_version_id" | "parents"
> & { client_name?: string | null; client_slug?: string | null };

export type ConversationItem = {
  id: string;
  kind: "comment" | "event" | "file";
  taskId: string;
  taskTitle: string;
  clientId: string | null;
  clientName: string | null;
  clientSlug?: string | null;
  path: string[];
  meetingDate: string | null;
  at: string;
  author: string | null;
  authorId?: string | null;
  editedAt?: string;
  assetIds?: string[];
  forTaskId?: string | null;
  text?: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
  file?: Record<string, unknown>;
};

export type ConversationRelations = {
  taskLinks: Array<{ parent_id: string; child_id: string; relation_kind: string; position?: number | null }>;
  routineLinks: Array<{ template_id: string; cycle_id: string; occurrence_date: string; task_id: string }>;
};

/** Projects content from its canonical card to a superior context. Structural
 * links, workflow stages and recurrence membership are traversed recursively.
 * Contextual routine links are followed only from that dated cycle; sibling
 * executions are never reached from an occurrence. */
export function projectCardConversation(input: {
  rootId: string;
  clientId?: string;
  tasks: readonly ConversationTask[];
  relations: ConversationRelations;
  events?: readonly Record<string, unknown>[];
  documents?: readonly Record<string, unknown>[];
  driveAssets?: readonly Record<string, unknown>[];
}): ConversationItem[] {
  const { rootId, relations } = input;
  const tasks = input.clientId ? input.tasks.filter((task) => task.client_id === input.clientId) : input.tasks;
  const allowedTaskIds = new Set(tasks.map((task) => task.id));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  if (input.clientId && !allowedTaskIds.has(rootId)) return [];
  const paths = new Map<string, string[]>();
  const contextPaths = new Map<string, Map<string, string[]>>();
  const visitedContexts = new Map<string, Set<string>>();
  const meetingDates = new Map<string, string | null>();
  const visiting = new Set<string>();
  const walk = (id: string, path: string[], meetingDate: string | null = null, deliveryIds: string[] = []) => {
    if (visiting.has(id)) return;
    const task = taskById.get(id);
    if (!task) return;
    const contextIds = task.workflow_version_id ? [...deliveryIds, id] : deliveryIds;
    const contextKey = contextIds.at(-1) ?? "";
    const taskContexts = visitedContexts.get(id) ?? new Set<string>();
    if (taskContexts.has(contextKey)) return;
    taskContexts.add(contextKey);
    visitedContexts.set(id, taskContexts);
    visiting.add(id);
    const nextPath = [...path, task.title];
    if (!paths.has(id)) paths.set(id, nextPath);
    const routePaths = contextPaths.get(id) ?? new Map<string, string[]>();
    routePaths.set(contextKey, nextPath);
    contextPaths.set(id, routePaths);
    const ownMeetingDate = meetingDate ?? (task.payload?.recurrence_parent_id ? String(task.payload?.occurrence_date ?? task.due_date ?? "").slice(0, 10) || null : null);
    meetingDates.set(id, ownMeetingDate);
    const linkedChildren = relations.taskLinks
      .filter((link) => link.parent_id === id && allowedTaskIds.has(link.child_id) && ["structural_member", "workflow_step"].includes(link.relation_kind))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.child_id.localeCompare(b.child_id));
    for (const link of linkedChildren) walk(link.child_id, nextPath, ownMeetingDate, contextIds);
    if (isRecurrenceTemplate(task)) {
      for (const cycle of tasks.filter((candidate) => candidate.plan_id === id).sort(taskOrder)) {
        const date = String(cycle.payload?.occurrence_date ?? cycle.due_date ?? "").slice(0, 10) || null;
        walk(cycle.id, nextPath, date, contextIds);
      }
    }
    // A meeting's explicit links expose the referenced plan and all of its
    // descendants. There is deliberately no reverse traversal from plan to
    // meetings and no inferred meeting link.
    for (const link of relations.routineLinks.filter((link) => link.cycle_id === id && allowedTaskIds.has(link.task_id)).sort((a, b) => a.task_id.localeCompare(b.task_id))) {
      walk(link.task_id, [...nextPath, `Reunião · ${link.occurrence_date}`], link.occurrence_date, contextIds);
    }
    visiting.delete(id);
  };
  walk(rootId, []);

  const items: ConversationItem[] = [];
  const seenComments = new Set<string>();
  for (const [taskId, path] of paths) {
    const task = taskById.get(taskId)!;
    for (const comment of commentsOf(task.payload as Record<string, unknown>)) {
      const unique = comment.id ? `${taskId}:${comment.id}` : `${taskId}:${comment.at}:${comment.author}:${comment.text}`;
      const selectedPath = comment.for_task_id ? contextPaths.get(taskId)?.get(comment.for_task_id) : path;
      if (comment.for_task_id && !selectedPath) continue;
      if (seenComments.has(unique)) continue;
      seenComments.add(unique);
      items.push({ ...common(task, selectedPath ?? path, meetingDates.get(taskId) ?? null, comment.at, comment.author), id: unique, kind: "comment", text: comment.text, authorId: comment.author_id ?? null, editedAt: comment.edited_at, assetIds: comment.asset_ids, forTaskId: comment.for_task_id });
    }
  }

  for (const event of input.events ?? []) {
    const taskId = String(event.task_id ?? "");
    const task = taskById.get(taskId);
    const path = paths.get(taskId);
    if (!task || !path) continue;
    const at = String(event.created_at ?? "");
    const selectedPath = typeof event.delivery_id === "string" ? contextPaths.get(taskId)?.get(event.delivery_id) : path;
    if (event.delivery_id && !selectedPath) continue;
    items.push({ ...common(task, selectedPath ?? path, meetingDates.get(taskId) ?? null, at, typeof event.actor_name === "string" ? event.actor_name : null), id: String(event.id ?? event.event_id ?? event.request_id ?? `${taskId}:${at}:${event.event_type}`), kind: "event", eventType: String(event.event_type ?? ""), text: typeof event.body === "string" ? event.body : undefined, metadata: objectValue(event.metadata) });
  }

  const visibleDocuments = (input.documents ?? []).filter((doc) => !input.clientId || doc.client_id === input.clientId);
  const documentById = new Map(visibleDocuments.map((doc) => [String(doc.id), doc]));
  for (const doc of visibleDocuments) {
    const taskId = String(doc.source_task_id ?? doc.task_id ?? "");
    const task = taskById.get(taskId);
    const path = paths.get(taskId);
    if (!task || !path) continue;
    const at = String(doc.created_at ?? doc.doc_date ?? "");
    items.push({ ...common(task, path, meetingDates.get(taskId) ?? null, at, null), id: `document:${String(doc.id)}`, kind: "file", file: { ...doc, sourceDocument: doc.source_document_id ? documentById.get(String(doc.source_document_id)) ?? null : null } });
  }
  for (const asset of input.driveAssets ?? []) {
    if (input.clientId && asset.client_id !== input.clientId) continue;
    const taskId = String(asset.creative_task_id ?? asset.source_task_id ?? "");
    const task = taskById.get(taskId);
    const path = paths.get(taskId);
    if (!task || !path || asset.state !== "active" || !["preview", "final"].includes(String(asset.role))) continue;
    items.push({ ...common(task, path, meetingDates.get(taskId) ?? null, String(asset.promoted_at ?? asset.created_at ?? ""), null), id: `drive:${String(asset.id)}`, kind: "file", file: asset });
  }

  const seenIds = new Set<string>();
  return items.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  }).sort((a, b) => timestamp(a.at) - timestamp(b.at) || a.id.localeCompare(b.id));
}

function common(task: ConversationTask, path: string[], meetingDate: string | null, at: string, author: string | null) {
  return { taskId: task.id, taskTitle: task.title, clientId: task.client_id, clientName: task.client_name ?? null, clientSlug: task.client_slug ?? null, path, meetingDate, at, author };
}
function taskOrder(a: ConversationTask, b: ConversationTask) { return (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.id.localeCompare(b.id); }
function timestamp(value: string) { const result = Date.parse(value); return Number.isNaN(result) ? 0 : result; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
