import { createAdminClient } from "./supabase/admin";
import { HttpError } from "./validation";
import { getDriveItemMetadata, isGoogleDriveConfigured, listFolderFilesPage, moveDriveItemBetweenFolders } from "./googleDriveApi";
import type { DriveFile } from "./googleDrive";
import { updateTaskPayload } from "./automations/taskWrites";
import { stableCommentId } from "./flows/statusComments";

type Db = ReturnType<typeof createAdminClient>;
type WorkspaceFolders = {
  id: string;
  plan_task_id: string;
  creative_task_id: string;
  stage_task_id: string | null;
  creative_folder_id: string | null;
  raw_folder_id: string | null;
  preview_folder_id: string | null;
  status: string;
  last_error: string | null;
};

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const MOVE_PENDING = "final_move_pending:";
/** Correção pontual (25/09): os arquivos em Preview deste criativo eram finais
 *  rebaixados por erro. Marcado no banco; a próxima sincronização — que é
 *  quem tem credencial do Drive — devolve cada um para a Home, e o áudio para
 *  Raw. Sem gerar comentário de chegada: não é um arquivo novo. */
export const RESTORE_FINALS_PENDING = "restore_finals_pending";

/** Áudio é material de edição, não entrega: vai sempre para Raw (25/09). */
function isAudio(file: DriveFile): boolean {
  return (file.mimeType ?? "").startsWith("audio/");
}

function isMaterial(file: DriveFile): boolean {
  return Boolean(file.id) && file.mimeType !== FOLDER && file.mimeType !== SHORTCUT;
}

export async function directFiles(folderId: string): Promise<DriveFile[]> {
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

/** Devolve se o arquivo foi registrado (false = saiu da pasta no meio da leitura). */
async function registerFile(db: Db, workspace: WorkspaceFolders, file: DriveFile, role: "raw" | "preview" | "final"): Promise<boolean> {
  const parentId = role === "final" ? workspace.creative_folder_id : role === "raw" ? workspace.raw_folder_id : workspace.preview_folder_id;
  if (!parentId) throw new HttpError(409, "Pasta do Criativo incompleta.");
  const verified = await getDriveItemMetadata(file.id);
  // A pessoa pode mover o arquivo no Drive entre a listagem e a leitura.
  if (!verified?.parents?.includes(parentId) || !isMaterial({ ...file, mimeType: verified.mimeType })) return false;
  const { error } = await db.rpc(role === "raw" ? "register_drive_raw_folder_asset" : "register_drive_folder_asset", {
    p_workspace_id: workspace.id,
    p_drive_file_id: verified.id,
    p_name: verified.name,
    p_mime_type: verified.mimeType,
    p_size_bytes: verified.size,
    p_web_view_link: verified.webViewLink,
    ...(role === "raw" ? {} : { p_role: role }),
    p_source_created_at: file.createdTime ?? null,
  });
  if (error) throw new HttpError(500, error.message);
  return true;
}

/** Tira um áudio da Home ou do Preview e guarda nos brutos do criativo. */
async function moveAudioToRaw(db: Db, workspace: WorkspaceFolders, file: DriveFile, fromFolderId: string): Promise<boolean> {
  if (!workspace.raw_folder_id) return false;
  await moveDriveItemBetweenFolders(file.id, fromFolderId, workspace.raw_folder_id);
  return registerFile(db, workspace, file, "raw");
}

/** A correção de RESTORE_FINALS_PENDING: tudo que está em Preview volta para a
 *  Home como final (as versões já existem e mantêm a data de promoção), e o
 *  áudio vai para Raw. */
async function restorePreviewToHome(db: Db, workspace: WorkspaceFolders): Promise<DriveFile[]> {
  const audio: DriveFile[] = [];
  for (const file of await directFiles(workspace.preview_folder_id!)) {
    if (isAudio(file)) {
      if (await moveAudioToRaw(db, workspace, file, workspace.preview_folder_id!)) audio.push(file);
      continue;
    }
    await moveDriveItemBetweenFolders(file.id, workspace.preview_folder_id!, workspace.creative_folder_id!);
    await registerFile(db, workspace, file, "final");
  }
  const { error } = await db.from("drive_creative_workspaces").update({ last_error: null }).eq("id", workspace.id);
  if (error) throw new HttpError(500, error.message);
  return audio;
}

/** Move os finais da Home do criativo para Preview e deixa um comentário
 *  North Ai no card do criativo — "sempre que isso ocorrer" (25/09): quem abre
 *  o card precisa saber por que a aba Finais esvaziou. Devolve os nomes. */
async function moveRootFinalsToPreview(db: Db, workspace: WorkspaceFolders): Promise<string[]> {
  if (!workspace.creative_folder_id || !workspace.preview_folder_id) return [];
  const files = await directFiles(workspace.creative_folder_id);
  const moved: DriveFile[] = [];
  for (const file of files) {
    await moveDriveItemBetweenFolders(file.id, workspace.creative_folder_id, workspace.preview_folder_id);
    await registerFile(db, workspace, file, "preview");
    moved.push(file);
  }
  if (moved.length) {
    await updateTaskPayload(db, workspace.creative_task_id, {
      text: `A Edição voltou para produção — os finais voltaram para Preview: ${moved.map((file) => file.name).join(", ")}.`,
      commentId: stableCommentId("finals-to-preview", workspace.creative_task_id, ...moved.map((file) => file.id).sort()),
    });
  }
  return moved.map((file) => file.name);
}

/** Status da Edição PARA ESTE criativo: a etapa é compartilhada, e desde 25/09
 *  cada Entrega pode ter o próprio andamento (`task_links.status_override`). */
async function effectiveStageStatus(db: Db, workspace: WorkspaceFolders): Promise<string | null> {
  if (!workspace.stage_task_id) return null;
  const [{ data: stage, error }, { data: link, error: linkError }] = await Promise.all([
    db.from("tasks").select("status").eq("id", workspace.stage_task_id).maybeSingle(),
    db.from("task_links").select("status_override").eq("parent_id", workspace.creative_task_id)
      .eq("child_id", workspace.stage_task_id).eq("relation_kind", "workflow_step").maybeSingle(),
  ]);
  if (error) throw new HttpError(500, error.message);
  if (linkError) throw new HttpError(500, linkError.message);
  return (link as { status_override?: string | null } | null)?.status_override ?? (stage as { status?: string } | null)?.status ?? null;
}

/** Reconcile the physical folders with the card. No content is copied.
 *
 *  Devolve os arquivos que CHEGARAM à Home do criativo nesta leitura — os que
 *  não eram finais ativos antes. É o gatilho de "arquivo novo na Home →
 *  Revisão" (lib/flows/homeArrival.ts). Um final que tinha voltado para Preview
 *  e foi posto na Home de novo conta como chegada: é uma entrega nova. */
export async function syncCreativeDriveFolders(db: Db, workspace: WorkspaceFolders): Promise<{ newHomeFiles: DriveFile[]; audioToRaw: DriveFile[] }> {
  if (workspace.status !== "ready"
    || !workspace.creative_folder_id || !workspace.preview_folder_id || !isGoogleDriveConfigured()) return { newHomeFiles: [], audioToRaw: [] };
  // Correção pontual primeiro: os restaurados entram como finais já conhecidos
  // (a lista `known` abaixo é lida depois) e não viram "arquivo novo".
  const audioToRaw: DriveFile[] = [];
  if (workspace.last_error === RESTORE_FINALS_PENDING) audioToRaw.push(...await restorePreviewToHome(db, workspace));
  if (workspace.last_error?.startsWith(MOVE_PENDING)) {
    if (await effectiveStageStatus(db, workspace) === "em_producao") {
      const pendingRoot = await directFiles(workspace.creative_folder_id);
      pendingRoot.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id));
      for (const file of pendingRoot) await registerFile(db, workspace, file, "final");
      await moveRootFinalsToPreview(db, workspace);
      const { error: clearError } = await db.from("drive_creative_workspaces").update({ last_error: null }).eq("id", workspace.id);
      if (clearError) throw new HttpError(500, clearError.message);
    }
  }
  const [root, previews, known] = await Promise.all([
    directFiles(workspace.creative_folder_id), directFiles(workspace.preview_folder_id), activeFinalFileIds(db, workspace.id),
  ]);
  // The Drive creation time is the order in which several new finals arrived.
  root.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id));
  const newHomeFiles: DriveFile[] = [];
  for (const file of root) {
    if (isAudio(file) && workspace.raw_folder_id) {
      if (await moveAudioToRaw(db, workspace, file, workspace.creative_folder_id)) audioToRaw.push(file);
      continue;
    }
    if (await registerFile(db, workspace, file, "final") && !known.has(file.id)) newHomeFiles.push(file);
  }
  for (const file of previews) {
    if (isAudio(file) && workspace.raw_folder_id) {
      if (await moveAudioToRaw(db, workspace, file, workspace.preview_folder_id)) audioToRaw.push(file);
      continue;
    }
    await registerFile(db, workspace, file, "preview");
  }
  if (workspace.raw_folder_id) {
    for (const file of await directFiles(workspace.raw_folder_id)) await registerFile(db, workspace, file, "raw");
  }
  return { newHomeFiles, audioToRaw };
}

/** Os arquivos que JÁ eram finais ativos deste criativo, antes da leitura. */
async function activeFinalFileIds(db: Db, workspaceId: string): Promise<Set<string>> {
  const { data, error } = await db.from("drive_assets").select("drive_file_id")
    .eq("workspace_id", workspaceId).eq("role", "final").eq("state", "active");
  if (error) throw new HttpError(500, error.message);
  return new Set(((data ?? []) as { drive_file_id: string }[]).map((row) => row.drive_file_id));
}

/**
 * Devolve para Preview os finais dos criativos que VOLTARAM para produção.
 *
 * Só os de `creativeTaskIds`. A Edição é compartilhada ("Edição — 6 Reels"
 * controla 6 pastas), e desde 25/09 o andamento pode ser por criativo: reabrir
 * a Edição só de "Divulgação Evento" varria as 6 pastas e apagou os finais
 * de outros cinco. Quem chama diz quais criativos de fato voltaram.
 */
export async function returnEditFinalsToPreview(db: Db, editTaskId: string, creativeTaskIds: readonly string[]): Promise<{ moved: number; errors: string[] }> {
  if (!creativeTaskIds.length) return { moved: 0, errors: [] };
  const { data, error } = await db.from("drive_creative_workspaces")
    .select("id,plan_task_id,creative_task_id,stage_task_id,creative_folder_id,raw_folder_id,preview_folder_id,status,last_error")
    .eq("stage_task_id", editTaskId).eq("status", "ready")
    .in("creative_task_id", [...creativeTaskIds]);
  if (error) throw new HttpError(500, error.message);
  let moved = 0;
  const errors: string[] = [];
  for (const workspace of (data ?? []) as WorkspaceFolders[]) {
    try {
      await syncCreativeDriveFolders(db, { ...workspace, last_error: null });
      moved += (await moveRootFinalsToPreview(db, workspace)).length;
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
