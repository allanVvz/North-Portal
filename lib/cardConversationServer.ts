import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./validation";
import { projectCardConversation, type ConversationItem, type ConversationRelations, type ConversationTask } from "./cardConversation";
import { isRecurrenceTemplate } from "./recurrenceState";

const PAGE_SIZE = 500;
const BATCH_SIZE = 150;
const TASK_COLUMNS = "id,client_id,kind,subtype,title,payload,plan_id,recurrence_cadence,due_date,workflow_version_id,created_at,updated_at,clients(name,slug)";

type ClientScope = { clientId?: string };

export async function loadCardConversation(db: SupabaseClient, rootId: string, scope: ClientScope = {}): Promise<ConversationItem[]> {
  const root = await fetchTasks(db, [rootId], scope);
  const rootTask = root.get(rootId);
  if (!rootTask) throw new HttpError(404, "Card não encontrado.");
  const tasks = new Map(root);
  const taskLinks: ConversationRelations["taskLinks"] = [];
  const routineLinks: ConversationRelations["routineLinks"] = [];
  const visited = new Set<string>();
  let frontier = [rootId];

  while (frontier.length) {
    const current = frontier.filter((id) => !visited.has(id));
    if (!current.length) break;
    current.forEach((id) => visited.add(id));
    const nextIds = new Set<string>();
    for (const ids of chunks(current, BATCH_SIZE)) {
      const [linkRows, routineRows] = await Promise.all([
        fetchInPages(db, "task_links", "parent_id,child_id,relation_kind,position", "parent_id", ids, "child_id", { relation_kind: ["structural_member", "workflow_step"] }, ["parent_id", "position", "child_id"]),
        fetchInPages(db, "routine_execution_links", "template_id,cycle_id,occurrence_date,task_id", "cycle_id", ids, "task_id", {}, ["occurrence_date", "task_id"]),
      ]);
      for (const row of linkRows) {
        const item = row as ConversationRelations["taskLinks"][number];
        taskLinks.push(item);
        nextIds.add(item.child_id);
      }
      for (const row of routineRows) {
        const item = row as ConversationRelations["routineLinks"][number];
        routineLinks.push(item);
        nextIds.add(item.task_id);
      }
    }

    // Recurrence membership lives on the task occurrence's plan_id. Only a
    // template expands that edge, so an occurrence can never absorb siblings.
    const templates = current.filter((id) => { const candidate = tasks.get(id); return candidate ? isRecurrenceTemplate(candidate) : false; });
    for (const ids of chunks(templates, BATCH_SIZE)) {
      const cycles = await fetchInPages(db, "tasks", "id", "plan_id", ids, "id", {}, ["id"]);
      for (const row of cycles) nextIds.add(String(row.id));
    }
    const children = await fetchTasks(db, [...nextIds], scope);
    for (const [id, task] of children) tasks.set(id, task);
    frontier = [...children.keys()];
  }

  const taskIds = [...tasks.keys()];
  const [events, documents, driveAssets] = await Promise.all([
    fetchInPages(db, "task_activity_events", "id,task_id,actor_id,actor_kind,event_type,body,metadata,request_id,delivery_id,created_at", "task_id", taskIds),
    fetchDocumentPages(db, taskIds),
    fetchDriveAssets(db, tasks),
  ]);
  const scopedDocuments = scope.clientId ? documents.filter((doc) => doc.client_id === scope.clientId) : documents;
  const scopedDriveAssets = scope.clientId ? driveAssets.filter((asset) => asset.client_id === scope.clientId) : driveAssets;
  const actorIds = [...new Set(events.map((event) => typeof event.actor_id === "string" ? event.actor_id : "").filter(Boolean))];
  const names = await profileNames(db, actorIds);
  for (const event of events) event.actor_name = typeof event.actor_id === "string"
    ? names.get(event.actor_id) ?? null
    : event.actor_kind === "north_ai" ? "North AI" : "Sistema";

  return projectCardConversation({ rootId, clientId: scope.clientId, tasks: [...tasks.values()], relations: { taskLinks, routineLinks }, events, documents: scopedDocuments, driveAssets: scopedDriveAssets });
}

async function fetchTasks(db: SupabaseClient, ids: string[], scope: ClientScope): Promise<Map<string, ConversationTask>> {
  const result = new Map<string, ConversationTask>();
  if (!ids.length) return result;
  for (const idBatch of chunks(ids, BATCH_SIZE)) {
    let query = db.from("tasks").select(TASK_COLUMNS).in("id", idBatch);
    if (scope.clientId) query = query.eq("client_id", scope.clientId);
    const { data, error } = await query;
    if (error) throw error;
    for (const raw of data ?? []) {
      const row = raw as Record<string, unknown>;
      const clients = Array.isArray(row.clients) ? row.clients[0] : row.clients;
      result.set(String(row.id), {
        id: String(row.id), client_id: typeof row.client_id === "string" ? row.client_id : null,
        kind: String(row.kind), subtype: typeof row.subtype === "string" ? row.subtype : null,
        title: String(row.title), payload: row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {},
        plan_id: typeof row.plan_id === "string" ? row.plan_id : null,
        recurrence_cadence: typeof row.recurrence_cadence === "string" ? row.recurrence_cadence as ConversationTask["recurrence_cadence"] : null,
        due_date: typeof row.due_date === "string" ? row.due_date : null,
        workflow_version_id: typeof row.workflow_version_id === "string" ? row.workflow_version_id : null,
        parents: [],
        client_name: clients && typeof clients === "object" && typeof (clients as { name?: unknown }).name === "string" ? (clients as { name: string }).name : null,
        client_slug: clients && typeof clients === "object" && typeof (clients as { slug?: unknown }).slug === "string" ? (clients as { slug: string }).slug : null,
      });
    }
  }
  return result;
}

async function fetchDocumentPages(db: SupabaseClient, taskIds: string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const ids of chunks(taskIds, BATCH_SIZE)) {
    for (const column of ["task_id", "source_task_id"]) {
      out.push(...await fetchInPages(db, "documents", "*", column, ids, "id", {}, ["created_at", "id"]));
    }
  }
  const unique = uniqueBy(out, (row) => String(row.id));
  const sourceIds = [...new Set(unique.map((row) => typeof row.source_document_id === "string" ? row.source_document_id : "").filter((id) => id && !unique.some((row) => row.id === id)))];
  for (const ids of chunks(sourceIds, BATCH_SIZE)) unique.push(...await fetchInPages(db, "documents", "*", "id", ids, "id", {}, ["created_at", "id"]));
  return uniqueBy(unique, (row) => String(row.id));
}

async function fetchDriveAssets(db: SupabaseClient, tasks: Map<string, ConversationTask>): Promise<Record<string, unknown>[]> {
  const creativeIds = [...tasks.keys()];
  if (!creativeIds.length) return [];
  const workspaces: Record<string, unknown>[] = [];
  for (const ids of chunks(creativeIds, BATCH_SIZE)) {
    workspaces.push(...await fetchInPages(db, "drive_creative_workspaces", "id,creative_task_id,client_id", "creative_task_id", ids, "id", {}, ["id"]));
  }
  const assets: Record<string, unknown>[] = [];
  const workspaceIds = workspaces.map((row) => String(row.id));
  for (const ids of chunks(workspaceIds, BATCH_SIZE)) {
    const [assetRows, versionRows] = await Promise.all([
      fetchInPages(db, "drive_assets", "id,workspace_id,drive_file_id,name,mime_type,size_bytes,role,state,web_view_link,created_at", "workspace_id", ids, "id", { role: ["preview", "final"] }, ["created_at", "id"]),
      fetchInPages(db, "drive_final_versions", "id,workspace_id,asset_id,version_number,state,promoted_at", "workspace_id", ids, "id", {}, ["promoted_at", "version_number", "id"]),
    ]);
    const workspaceById = new Map(workspaces.map((row) => [String(row.id), row]));
    const versionByAsset = new Map(versionRows.map((version) => [String(version.asset_id), version]));
    assets.push(...assetRows.map((asset) => {
      const version = versionByAsset.get(String(asset.id));
      const workspace = workspaceById.get(String(asset.workspace_id));
      return { ...asset, version_id: version?.id ?? null, version_number: version?.version_number ?? null, version_state: version?.state ?? null, promoted_at: version?.promoted_at ?? null, creative_task_id: workspace?.creative_task_id, client_id: workspace?.client_id };
    }));
  }
  return assets;
}

async function profileNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const batch of chunks(ids, BATCH_SIZE)) {
    const { data, error } = await db.from("profiles").select("id,full_name").in("id", batch);
    if (error) throw error;
    for (const row of data ?? []) result.set(String((row as { id: string }).id), String((row as { full_name?: string }).full_name ?? ""));
  }
  return result;
}

async function fetchInPages(db: SupabaseClient, table: string, columns: string, key: string, ids: string[], tieBreaker = key, filters: Record<string, string[]> = {}, orderColumns: string[] = ["created_at", tieBreaker]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const batch of chunks(ids, BATCH_SIZE)) {
    let offset = 0;
    while (true) {
      let query = db.from(table).select(columns).in(key, batch);
      for (const [column, values] of Object.entries(filters)) query = query.in(column, values);
      for (const column of orderColumns) query = query.order(column, { ascending: true, nullsFirst: true });
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  return out;
}

function chunks<T>(items: T[], size: number): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; }); }
