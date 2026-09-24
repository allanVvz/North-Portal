import { createAdminClient } from "./supabase/admin";
import { HttpError } from "./validation";
import { getDriveItemMetadata, isGoogleDriveConfigured, listFolderFilesPage, moveDriveItemBetweenFolders } from "./googleDriveApi";
import type { DriveFile } from "./googleDrive";
import { BAITA_DRIVE_PLAN_ID } from "./cardMaterials";

type Db = ReturnType<typeof createAdminClient>;
type WorkspaceFolders = {
  id: string;
  plan_task_id: string;
  stage_task_id: string | null;
  creative_folder_id: string | null;
  preview_folder_id: string | null;
  status: string;
  last_error: string | null;
};

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const MOVE_PENDING = "final_move_pending:";

function isMaterial(file: DriveFile): boolean {
  return Boolean(file.id) && file.mimeType !== FOLDER && file.mimeType !== SHORTCUT;
}

async function directFiles(folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const result = await listFolderFilesPage(folderId, 1000, token, true);
    files.push(...result.files.filter(isMaterial));
    if (!result.nextPageToken) return files;
    token = result.nextPageToken;
  }
  throw new HttpError(409, "Pasta do Criativo excede o limite de sincronizacao; nenhum arquivo foi registrado parcialmente.");
}

async function registerFile(db: Db, workspace: WorkspaceFolders, file: DriveFile, role: "preview" | "final") {
  const parentId = role === "final" ? workspace.creative_folder_id : workspace.preview_folder_id;
  if (!parentId) throw new HttpError(409, "Pasta do Criativo incompleta.");
  const verified = await getDriveItemMetadata(file.id);
  // A pessoa pode mover o arquivo no Drive entre a listagem e a leitura.
  if (!verified?.parents?.includes(parentId) || !isMaterial({ ...file, mimeType: verified.mimeType })) return;
  const { error } = await db.rpc("register_drive_folder_asset", {
    p_workspace_id: workspace.id,
    p_drive_file_id: verified.id,
    p_name: verified.name,
    p_mime_type: verified.mimeType,
    p_size_bytes: verified.size,
    p_web_view_link: verified.webViewLink,
    p_role: role,
    p_source_created_at: file.createdTime ?? null,
  });
  if (error) throw new HttpError(500, error.message);
}

async function moveRootFinalsToPreview(db: Db, workspace: WorkspaceFolders): Promise<number> {
  if (!workspace.creative_folder_id || !workspace.preview_folder_id) return 0;
  const files = await directFiles(workspace.creative_folder_id);
  let moved = 0;
  for (const file of files) {
    await moveDriveItemBetweenFolders(file.id, workspace.creative_folder_id, workspace.preview_folder_id);
    await registerFile(db, workspace, file, "preview");
    moved += 1;
  }
  return moved;
}

/** Reconcile the physical folders with the card. No content is copied. */
export async function syncCreativeDriveFolders(db: Db, workspace: WorkspaceFolders): Promise<void> {
  if (workspace.plan_task_id !== BAITA_DRIVE_PLAN_ID || workspace.status !== "ready"
    || !workspace.creative_folder_id || !workspace.preview_folder_id || !isGoogleDriveConfigured()) return;
  if (workspace.last_error?.startsWith(MOVE_PENDING)) {
    const { data: edit, error } = await db.from("tasks").select("status").eq("id", workspace.stage_task_id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (edit?.status === "em_producao") {
      const pendingRoot = await directFiles(workspace.creative_folder_id);
      pendingRoot.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id));
      for (const file of pendingRoot) await registerFile(db, workspace, file, "final");
      await moveRootFinalsToPreview(db, workspace);
      const { error: clearError } = await db.from("drive_creative_workspaces").update({ last_error: null }).eq("id", workspace.id);
      if (clearError) throw new HttpError(500, clearError.message);
    }
  }
  const [root, previews] = await Promise.all([
    directFiles(workspace.creative_folder_id), directFiles(workspace.preview_folder_id),
  ]);
  // The Drive creation time is the order in which several new finals arrived.
  root.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id));
  for (const file of root) await registerFile(db, workspace, file, "final");
  for (const file of previews) await registerFile(db, workspace, file, "preview");
}

/** A shared Edit card may control several independent Creative folders. */
export async function returnEditFinalsToPreview(db: Db, editTaskId: string): Promise<{ moved: number; errors: string[] }> {
  const { data, error } = await db.from("drive_creative_workspaces")
    .select("id,plan_task_id,stage_task_id,creative_folder_id,preview_folder_id,status,last_error")
    .eq("plan_task_id", BAITA_DRIVE_PLAN_ID).eq("stage_task_id", editTaskId).eq("status", "ready");
  if (error) throw new HttpError(500, error.message);
  let moved = 0;
  const errors: string[] = [];
  for (const workspace of (data ?? []) as WorkspaceFolders[]) {
    try {
      await syncCreativeDriveFolders(db, { ...workspace, last_error: null });
      moved += await moveRootFinalsToPreview(db, workspace);
      const { error: clearError } = await db.from("drive_creative_workspaces").update({ last_error: null }).eq("id", workspace.id);
      if (clearError) throw clearError;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao mover finais para Preview.";
      errors.push(message);
      await db.from("drive_creative_workspaces").update({ last_error: `${MOVE_PENDING}${message.slice(0, 900)}` }).eq("id", workspace.id);
    }
  }
  return { moved, errors };
}
