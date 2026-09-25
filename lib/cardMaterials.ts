import { familyCardsOf } from "./comments";
import { isRecurrenceTemplate } from "./recurrenceState";
import type { TaskCover } from "./taskCover";
import type { TaskRecord } from "./validation";

export const BAITA_DRIVE_PLAN_ID = "7e1a162d-ff0f-414e-ad50-bea8b472fbcd";

export type CreativeMaterialAsset = {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number | null;
  role: "raw" | "preview" | "final";
  state: "uploading" | "active" | "trashed" | "error";
  web_view_link: string | null;
  created_at: string;
};

export type CreativeMaterialWorkspace = {
  id: string;
  plan_task_id: string;
  capture_task_id: string;
  creative_task_id: string;
  creative_title?: string | null;
  status: string;
  available_raw_count?: number | null;
  available_raw_limited?: boolean;
  assets: CreativeMaterialAsset[];
  raw_links: Array<{ asset_id: string }>;
  final_versions: Array<{
    id: string;
    asset_id: string;
    version_number: number;
    state: "current" | "superseded" | "trashed";
    promoted_at: string;
  }>;
};

/** Keep every mirror inside the opened execution. A recurrence template has no
 * single execution and must not merge the files of its different cycles. */
export function materialCardsOf(task: TaskRecord, tasks: readonly TaskRecord[]): TaskRecord[] {
  if (isRecurrenceTemplate(task)) return [task];
  return familyCardsOf(task, tasks);
}

export function creativeWorkspacesForCard(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  workspaces: readonly CreativeMaterialWorkspace[],
): CreativeMaterialWorkspace[] {
  const family = new Set(materialCardsOf(task, tasks).map((card) => card.id));
  return workspaces.filter((workspace) =>
    family.has(workspace.creative_task_id) ||
    task.id === workspace.capture_task_id ||
    task.id === workspace.creative_task_id,
  );
}

export function currentFinalAsset(workspace: CreativeMaterialWorkspace): CreativeMaterialAsset | null {
  const current = workspace.final_versions.find((version) => version.state === "current");
  return workspace.assets.find((asset) => asset.id === current?.asset_id && asset.role === "final" && asset.state === "active") ?? null;
}

export function materialCoverCandidates(workspaces: readonly CreativeMaterialWorkspace[]): TaskCover[] {
  // The physical folder decides the cover: newest file in Home, then newest
  // file in Preview. Keep all older files as thumbnail fallbacks. A final
  // version can remain in the ledger after a file moves to Preview, so the
  // asset's current role is the source of truth here.
  const active = workspaces.flatMap((workspace) => workspace.assets)
    .filter((asset) => asset.state === "active" && (asset.role === "final" || asset.role === "preview"))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "final" ? -1 : 1;
      return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
    });
  const seen = new Set<string>();
  return active.filter((asset) => {
    if (seen.has(asset.drive_file_id)) return false;
    seen.add(asset.drive_file_id);
    return true;
  }).map((asset) => ({ fileId: asset.drive_file_id, source: "comments" as const }));
}
