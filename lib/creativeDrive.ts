import { createAdminClient } from "./supabase/admin";
import { HttpError } from "./validation";
import {
  createDriveResumableUpload,
  createDriveShortcut,
  ensureDriveFolder,
  getDriveItemMetadata,
  listFolderFiles,
  listFolderFilesPage,
  moveDriveItemBetweenFolders,
  renameDriveFolder,
  setDriveItemTrashed,
  type DriveItemMetadata,
} from "./googleDriveApi";
import { creativeDriveAppProperties } from "./creativeDriveModel";
import { BAITA_DRIVE_PLAN_ID } from "./cardMaterials";
import { isCreativeDeliveryKind } from "./canonicalDeliveryFormats";
import { ensureDailySeries, type DailySeries } from "./automations/dailySeries";

export { BAITA_DRIVE_PLAN_ID };

type Db = ReturnType<typeof createAdminClient>;
type TaskRow = {
  id: string;
  client_id: string | null;
  plan_id: string | null;
  title: string;
  kind: string;
  workflow_version_id: string | null;
  subtype: string | null;
  payload: Record<string, unknown> | null;
  due_date: string | null;
  start_date: string | null;
  scheduled_start_at: string | null;
};

type LinkRow = { parent_id: string; child_id: string; slot: string | null; relation_kind: string };

export type CreativeDriveContext = {
  clientId: string;
  dailyConfigId: string | null;
  routineTaskId: string | null;
  planTaskId: string;
  captureTaskId: string | null;
  creativeTaskId: string;
  stageTaskId: string | null;
  captureDate: string | null;
  creativeTitle: string;
  clientName: string;
  formatName: string | null;
};

export type CreativeDriveWorkspace = {
  id: string;
  status: "pending" | "ready" | "error" | "disabled";
  last_error: string | null;
  routine_task_id: string | null;
  plan_task_id: string;
  capture_task_id: string | null;
  creative_task_id: string;
  stage_task_id: string | null;
  creative_folder_id: string | null;
  raw_folder_id: string | null;
  preview_folder_id: string | null;
  capture_workspace: {
    capture_date: string | null;
    daily_folder_id: string | null;
    script_folder_id: string | null;
    capture_folder_id: string | null;
  } | null;
  assets: Array<{
    id: string;
    drive_file_id: string;
    name: string;
    mime_type: string;
    size_bytes: number | null;
    role: "raw" | "preview" | "final";
    state: "uploading" | "active" | "trashed" | "error";
    web_view_link: string | null;
    created_at: string;
  }>;
  raw_links: Array<{ asset_id: string; shortcut_drive_file_id: string | null }>;
  final_versions: Array<{
    id: string;
    asset_id: string;
    version_number: number;
    state: "current" | "superseded" | "trashed";
    promoted_at: string;
  }>;
  source_files: {
    script: Awaited<ReturnType<typeof listFolderFiles>>;
    capture: Awaited<ReturnType<typeof listFolderFiles>>;
  };
  source_next_page_token: { script: string | null; capture: string | null };
  source_error: string | null;
};

function failDb(error: { message: string } | null): void {
  if (error) throw new HttpError(500, error.message);
}

function dailyLabel(date: string | null): string {
  if (!date) return "Bruto - diaria de gravacao";
  const [year, month, day] = date.slice(0, 10).split("-");
  return `Bruto - diaria de gravacao (${day}-${month}-${year})`;
}

async function taskById(db: Db, id: string): Promise<TaskRow> {
  const { data, error } = await db.from("tasks")
    .select("id,client_id,plan_id,title,kind,subtype,workflow_version_id,payload,due_date,start_date,scheduled_start_at")
    .eq("id", id).maybeSingle();
  failDb(error);
  if (!data) throw new HttpError(404, "Card nao encontrado.");
  return data as TaskRow;
}

/** Resolve a diaria pelo card compartilhado de Captacao, nunca pela data. */
export async function resolveCreativeDriveContext(db: Db, creativeTaskId: string): Promise<CreativeDriveContext> {
  const creative = await taskById(db, creativeTaskId);
  if (!creative.workflow_version_id || !isCreativeDeliveryKind(creative.kind)) throw new HttpError(400, "O workspace pertence a uma Entrega criativa.");

  const { data: parentLinks, error: parentError } = await db.from("task_links")
    .select("parent_id,child_id,slot,relation_kind").eq("child_id", creativeTaskId).eq("relation_kind", "structural_member");
  failDb(parentError);
  const planIds = (parentLinks as LinkRow[] | null ?? []).map((link) => link.parent_id);
  let plan: TaskRow | null = null;
  for (const candidateId of planIds) {
    const candidate = await taskById(db, candidateId);
    if (candidate.kind !== "plano_acao" || !candidate.client_id || candidate.client_id !== creative.client_id) continue;
    const moldId = typeof candidate.payload?.recurrence_parent_id === "string" ? candidate.payload.recurrence_parent_id : candidate.id;
    const [{ data: allowed, error: allowedError }, { data: daily, error: dailyError }] = await Promise.all([
      db.from("drive_workspace_plan_allowlist").select("enabled").eq("plan_task_id", candidate.id).maybeSingle(),
      db.from("automation_configs").select("id,daily_config").eq("target_task_id", moldId)
        .eq("automation_key", "diaria_recorrente").order("created_at").limit(1).maybeSingle(),
    ]);
    failDb(allowedError); failDb(dailyError);
    const snapshot = candidate.payload?.daily_effective as { clientId?: string } | undefined;
    const snapshotMatches = typeof candidate.payload?.daily_config_id === "string" &&
      snapshot?.clientId === candidate.client_id && moldId !== candidate.id;
    if (allowed?.enabled || snapshotMatches || (daily?.daily_config as { clientId?: string } | null)?.clientId === candidate.client_id) {
      plan = candidate; break;
    }
  }
  if (!plan) throw new HttpError(403, "Este Criativo não pertence a uma diária configurada para o cliente.");
  if (plan.kind !== "plano_acao") throw new HttpError(409, "O escopo autorizado deixou de ser um Plano de Acao.");
  if (!creative.client_id || creative.client_id !== plan.client_id) throw new HttpError(409, "Plano e Criativo precisam pertencer ao mesmo cliente.");
  const { data: client, error: clientError } = await db.from("clients").select("name").eq("id", creative.client_id).single();
  failDb(clientError);
  if (!client) throw new HttpError(409, "Cliente do Criativo nao encontrado.");

  const { data: stepLinks, error: stepError } = await db.from("task_links")
    .select("parent_id,child_id,slot,relation_kind").eq("parent_id", creativeTaskId).eq("relation_kind", "workflow_step");
  failDb(stepError);
  const links = (stepLinks as LinkRow[] | null) ?? [];
  const captureLink = links.find((link) => link.slot === "captacao");
  const editLink = links.find((link) => link.slot === "edicao");
  const sharedCaptureId = typeof plan.payload?.daily_capture_task_id === "string" ? plan.payload.daily_capture_task_id : null;
  const capture = captureLink ? await taskById(db, captureLink.child_id)
    : sharedCaptureId ? await taskById(db, sharedCaptureId) : null;
  if (capture && capture.client_id !== plan.client_id) throw new HttpError(409, "Captação e Plano precisam pertencer ao mesmo cliente.");

  return {
    clientId: creative.client_id,
    dailyConfigId: typeof plan.payload?.daily_config_id === "string" ? plan.payload.daily_config_id : null,
    routineTaskId: plan.plan_id,
    planTaskId: plan.id,
    captureTaskId: capture?.id ?? null,
    creativeTaskId: creative.id,
    stageTaskId: editLink?.child_id ?? null,
    captureDate: (capture?.scheduled_start_at ?? capture?.start_date ?? capture?.due_date)?.slice(0, 10) ?? null,
    creativeTitle: creative.title,
    clientName: client.name,
    formatName: typeof creative.payload?.formato === "string" && creative.payload.formato.trim() ? creative.payload.formato.trim() : null,
  };
}

export function creativeFolderNames(context: Pick<CreativeDriveContext, "clientName" | "formatName" | "creativeTitle">) {
  const base = [context.clientName, context.formatName, context.creativeTitle]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim().replace(/\s+/g, " ")).join(" · ");
  return { root: base, raw: `${base} · Raw`, preview: `${base} · Preview` };
}

export async function canManageCreativeAssets(db: Db, userId: string, level: string | null, context: CreativeDriveContext): Promise<boolean> {
  if (level === "gerente") return true;
  const taskIds = [context.creativeTaskId, context.stageTaskId, context.captureTaskId]
    .filter((id): id is string => Boolean(id));
  const { data, error } = await db.from("task_assignees").select("task_id").eq("profile_id", userId).in("task_id", taskIds);
  failDb(error);
  return Boolean(data?.length);
}

export async function provisionCreativeDriveWorkspace(db: Db, creativeTaskId: string, preparedSeries?: DailySeries): Promise<CreativeDriveWorkspace> {
  const context = await resolveCreativeDriveContext(db, creativeTaskId);
  // resolveCreativeDriveContext has already checked the configured client and
  // exact structural Plan. Workspaces are still keyed by that execution Plan.

  const { data: links, error: linksError } = await db.from("client_drive_links")
    .select("raw_folder_id,uploads_folder_id").eq("client_id", context.clientId).maybeSingle();
  failDb(linksError);
  if (!links?.raw_folder_id || !links?.uploads_folder_id) {
    throw new HttpError(409, "Cadastre as pastas Raw e Edição do cliente antes de provisionar.");
  }
  const series = context.dailyConfigId
    ? preparedSeries ?? await ensureDailySeries(db, context.dailyConfigId) : null;
  const dailyParentId = series?.folderId ?? links.raw_folder_id;

  let captureWorkspace: { id: string; daily_folder_id: string | null; script_folder_id: string | null; capture_folder_id: string | null; provision_attempts: number } | null = null;
  if (context.captureTaskId) {
    const { data, error } = await db.from("drive_capture_workspaces")
      .upsert({
        client_id: context.clientId, routine_task_id: context.routineTaskId,
        plan_task_id: context.planTaskId, capture_task_id: context.captureTaskId,
        capture_date: context.captureDate, status: "pending",
      }, { onConflict: "plan_task_id,capture_task_id", ignoreDuplicates: false })
      .select("*").single();
    failDb(error);
    captureWorkspace = data;
  }

  const { data: creativeWorkspace, error: creativeSeedError } = await db.from("drive_creative_workspaces")
    .upsert({
      capture_workspace_id: captureWorkspace?.id ?? null,
      client_id: context.clientId,
      routine_task_id: context.routineTaskId,
      plan_task_id: context.planTaskId,
      capture_task_id: context.captureTaskId,
      creative_task_id: context.creativeTaskId,
      stage_task_id: context.stageTaskId,
      status: "pending",
    }, { onConflict: "creative_task_id", ignoreDuplicates: false })
    .select("*").single();
  failDb(creativeSeedError);

  try {
    const names = creativeFolderNames(context);
    // The capture is shared by several creatives. Reuse its recorded folders
    // before searching by tags; legacy runs created duplicate same-name folders.
    async function recordedFolder(id: string | null, parentId: string, legacyParentId?: string): Promise<{ id: string } | null> {
      if (!id) return null;
      const file = await getDriveItemMetadata(id);
      if (!file) throw new HttpError(502, "Uma pasta registrada esta inacessivel no Google Drive.");
      if (file.mimeType !== "application/vnd.google-apps.folder" ||
          !file.parents?.some((parent) => parent === parentId || parent === legacyParentId)) {
        throw new HttpError(409, "Uma pasta registrada nao pertence a pasta esperada.");
      }
      return { id: file.id };
    }
    let daily: { id: string } | null = null;
    let script: { id: string } | null = null;
    let capture: { id: string } | null = null;
    if (captureWorkspace) {
      daily = await recordedFolder(captureWorkspace.daily_folder_id, dailyParentId, series ? links.raw_folder_id : undefined) ?? await ensureDriveFolder({
        name: dailyLabel(context.captureDate), parentId: dailyParentId,
        appProperties: creativeDriveAppProperties(context, "daily_root"),
      });
      [script, capture] = await Promise.all([
        recordedFolder(captureWorkspace.script_folder_id, daily.id).then((found) => found ?? ensureDriveFolder({ name: "Roteiro", parentId: daily!.id, appProperties: creativeDriveAppProperties(context, "script") })),
        recordedFolder(captureWorkspace.capture_folder_id, daily.id).then((found) => found ?? ensureDriveFolder({ name: "Captacao", parentId: daily!.id, appProperties: creativeDriveAppProperties(context, "capture") })),
      ]);
    }
    const creative = await recordedFolder(creativeWorkspace.creative_folder_id, links.uploads_folder_id) ?? await ensureDriveFolder({
      name: names.root, parentId: links.uploads_folder_id,
      appProperties: creativeDriveAppProperties(context, "creative_root"),
    });
    const preview = await recordedFolder(creativeWorkspace.preview_folder_id, creative.id) ?? await ensureDriveFolder({
      name: names.preview, parentId: creative.id,
      appProperties: creativeDriveAppProperties(context, "preview"),
    });
    const raw = await recordedFolder(creativeWorkspace.raw_folder_id, creative.id) ?? await ensureDriveFolder({
      name: names.raw, parentId: creative.id,
      appProperties: creativeDriveAppProperties(context, "raw_folder"),
    });
    await Promise.all([
      renameDriveFolder(creative.id, links.uploads_folder_id, names.root),
      renameDriveFolder(preview.id, creative.id, names.preview),
      renameDriveFolder(raw.id, creative.id, names.raw),
    ]);
    const { data: oldLinks, error: oldLinksError } = await db.from("drive_raw_asset_links")
      .select("shortcut_drive_file_id").eq("workspace_id", creativeWorkspace.id).not("shortcut_drive_file_id", "is", null);
    failDb(oldLinksError);
    for (let offset = 0; offset < (oldLinks?.length ?? 0); offset += 8) {
      await Promise.all((oldLinks ?? []).slice(offset, offset + 8).map(async (link) => {
        if (!link.shortcut_drive_file_id) return;
        const shortcut = await getDriveItemMetadata(link.shortcut_drive_file_id);
        if (!shortcut) return;
        if (shortcut.mimeType !== "application/vnd.google-apps.shortcut") throw new HttpError(409, "O atalho classificado mudou de tipo no Drive.");
        await moveDriveItemBetweenFolders(shortcut.id, creative.id, raw.id, true);
      }));
    }
    const now = new Date().toISOString();
    if (captureWorkspace && daily && script && capture) {
      const { error: captureUpdateError } = await db.from("drive_capture_workspaces").update({
        daily_folder_id: daily.id, script_folder_id: script.id, capture_folder_id: capture.id,
        status: "ready", last_error: null, provisioned_at: now,
        provision_attempts: (captureWorkspace.provision_attempts ?? 0) + 1,
      }).eq("id", captureWorkspace.id);
      failDb(captureUpdateError);
    }
    const { error: creativeUpdateError } = await db.from("drive_creative_workspaces").update({
      creative_folder_id: creative.id, raw_folder_id: raw.id, preview_folder_id: preview.id,
      status: "ready", last_error: null, provisioned_at: now,
      provision_attempts: (creativeWorkspace.provision_attempts ?? 0) + 1,
    }).eq("id", creativeWorkspace.id);
    failDb(creativeUpdateError);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 1000) : "Falha desconhecida no Google Drive.";
    await Promise.all([
      ...(captureWorkspace ? [db.from("drive_capture_workspaces").update({ status: "error", last_error: message, provision_attempts: (captureWorkspace.provision_attempts ?? 0) + 1 }).eq("id", captureWorkspace.id)] : []),
      db.from("drive_creative_workspaces").update({ status: "error", last_error: message, provision_attempts: (creativeWorkspace.provision_attempts ?? 0) + 1 }).eq("id", creativeWorkspace.id),
    ]);
    throw cause;
  }
  return getCreativeDriveWorkspace(db, creativeTaskId) as Promise<CreativeDriveWorkspace>;
}

/** Cards fora de um Plano com materiais configurados não precisam de workspace. */
export async function provisionCreativeDriveWorkspaceIfConfigured(
  db: Db, creativeTaskId: string,
): Promise<CreativeDriveWorkspace | null> {
  try {
    await resolveCreativeDriveContext(db, creativeTaskId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return null;
    throw error;
  }
  return provisionCreativeDriveWorkspace(db, creativeTaskId);
}

export async function getCreativeDriveWorkspace(db: Db, creativeTaskId: string, includeSources = true): Promise<CreativeDriveWorkspace | null> {
  const { data: row, error } = await db.from("drive_creative_workspaces")
    .select("*,capture_workspace:drive_capture_workspaces(capture_date,daily_folder_id,script_folder_id,capture_folder_id)")
    .eq("creative_task_id", creativeTaskId).maybeSingle();
  failDb(error);
  if (!row) return null;
  const [{ data: assets, error: assetsError }, { data: rawLinks, error: rawError }, { data: versions, error: versionsError }] = await Promise.all([
    db.from("drive_assets").select("id,drive_file_id,name,mime_type,size_bytes,role,state,web_view_link,created_at").eq("workspace_id", row.id).order("created_at", { ascending: false }),
    db.from("drive_raw_asset_links").select("asset_id,shortcut_drive_file_id").eq("workspace_id", row.id),
    db.from("drive_final_versions").select("id,asset_id,version_number,state,promoted_at").eq("workspace_id", row.id).order("version_number", { ascending: false }),
  ]);
  failDb(assetsError); failDb(rawError); failDb(versionsError);
  const captureWorkspace = Array.isArray(row.capture_workspace) ? row.capture_workspace[0] : row.capture_workspace;
  const [scriptResult, captureResult] = includeSources ? await Promise.allSettled([
    captureWorkspace?.script_folder_id ? listFolderFilesPage(captureWorkspace.script_folder_id, 1000, null, true) : { files: [], nextPageToken: null },
    captureWorkspace?.capture_folder_id ? listFolderFilesPage(captureWorkspace.capture_folder_id, 1000, null, true) : { files: [], nextPageToken: null },
  ]) : [{ status: "fulfilled", value: { files: [], nextPageToken: null } }, { status: "fulfilled", value: { files: [], nextPageToken: null } }] as const;
  const sourceFiles = (files: readonly Awaited<ReturnType<typeof listFolderFilesPage>>["files"][number][]) =>
    files.filter((file) => file.mimeType !== "application/vnd.google-apps.shortcut" &&
      file.mimeType !== "application/vnd.google-apps.folder");
  return {
    ...row,
    capture_workspace: captureWorkspace ?? null,
    assets: assets ?? [],
    raw_links: rawLinks ?? [],
    final_versions: versions ?? [],
    source_files: {
      script: scriptResult.status === "fulfilled" ? sourceFiles(scriptResult.value.files) : [],
      capture: captureResult.status === "fulfilled" ? sourceFiles(captureResult.value.files) : [],
    },
    source_next_page_token: {
      script: scriptResult.status === "fulfilled" ? scriptResult.value.nextPageToken : null,
      capture: captureResult.status === "fulfilled" ? captureResult.value.nextPageToken : null,
    },
    source_error: scriptResult.status === "rejected" || captureResult.status === "rejected"
      ? "Não foi possível listar os brutos desta Captação no Google Drive." : null,
  } as CreativeDriveWorkspace;
}

async function readyWorkspace(db: Db, creativeTaskId: string) {
  const workspace = await getCreativeDriveWorkspace(db, creativeTaskId, false);
  if (!workspace || workspace.status !== "ready" || !workspace.preview_folder_id || !workspace.creative_folder_id || !workspace.raw_folder_id) {
    throw new HttpError(409, "O workspace ainda nao esta pronto.");
  }
  return workspace;
}

export async function startCreativeUpload(db: Db, userId: string, creativeTaskId: string, file: { name: string; mimeType: string; size: number }) {
  const context = await resolveCreativeDriveContext(db, creativeTaskId);
  const workspace = await readyWorkspace(db, creativeTaskId);
  const session = await createDriveResumableUpload({
    name: file.name, mimeType: file.mimeType, size: file.size, parentId: workspace.preview_folder_id!,
    appProperties: creativeDriveAppProperties(context, "preview_asset"),
  });
  return { ...session, workspaceId: workspace.id };
}

export async function completeCreativeUpload(db: Db, userId: string, creativeTaskId: string, driveFileId: string) {
  const workspace = await readyWorkspace(db, creativeTaskId);
  const file = await getDriveItemMetadata(driveFileId);
  if (!file || !file.parents?.includes(workspace.preview_folder_id!)) throw new HttpError(400, "O upload nao pertence ao Preview deste Criativo.");
  const { data, error } = await db.from("drive_assets").upsert({
    workspace_id: workspace.id, drive_file_id: file.id, name: file.name, mime_type: file.mimeType,
    size_bytes: file.size, role: "preview", state: "active", web_view_link: file.webViewLink,
    uploaded_by: userId, upload_session_expires_at: null,
  }, { onConflict: "workspace_id,drive_file_id", ignoreDuplicates: false }).select("*").single();
  failDb(error);
  return data;
}

export async function linkRawAsset(db: Db, userId: string, creativeTaskId: string, file: DriveItemMetadata) {
  const context = await resolveCreativeDriveContext(db, creativeTaskId);
  const workspace = await readyWorkspace(db, creativeTaskId);
  const verified = await getDriveItemMetadata(file.id);
  const allowedParents = [workspace.capture_workspace?.script_folder_id, workspace.capture_workspace?.capture_folder_id]
    .filter((id): id is string => Boolean(id));
  if (!verified || verified.mimeType === "application/vnd.google-apps.shortcut" ||
      verified.mimeType === "application/vnd.google-apps.folder" ||
      !verified.parents?.some((parent) => allowedParents.includes(parent))) {
    throw new HttpError(400, "O bruto nao pertence ao Roteiro ou a Captacao desta diaria.");
  }
  file = verified;
  const { data: asset, error: assetError } = await db.from("drive_assets").upsert({
    workspace_id: workspace.id, drive_file_id: file.id, name: file.name, mime_type: file.mimeType,
    size_bytes: file.size, role: "raw", state: "active", web_view_link: file.webViewLink, uploaded_by: userId,
  }, { onConflict: "workspace_id,drive_file_id", ignoreDuplicates: false }).select("*").single();
  failDb(assetError);
  const { data: existingLink, error: existingLinkError } = await db.from("drive_raw_asset_links")
    .select("shortcut_drive_file_id").eq("workspace_id", workspace.id).eq("asset_id", asset.id).maybeSingle();
  failDb(existingLinkError);
  if (existingLink?.shortcut_drive_file_id) {
    const shortcut = await getDriveItemMetadata(existingLink.shortcut_drive_file_id);
    if (shortcut) {
      await moveDriveItemBetweenFolders(shortcut.id, workspace.creative_folder_id!, workspace.raw_folder_id!, true);
      return asset;
    }
  }
  const shortcutId = await createDriveShortcut({
    name: file.name,
    parentId: workspace.raw_folder_id!, targetId: file.id,
    appProperties: { ...creativeDriveAppProperties(context, "raw_shortcut"), asset_id: asset.id },
  });
  const { error } = await db.from("drive_raw_asset_links").upsert({
    workspace_id: workspace.id, asset_id: asset.id, shortcut_drive_file_id: shortcutId, created_by: userId,
  }, { onConflict: "workspace_id,asset_id", ignoreDuplicates: false });
  failDb(error);
  return asset;
}

export async function unlinkRawAsset(db: Db, creativeTaskId: string, assetId: string): Promise<void> {
  const workspace = await readyWorkspace(db, creativeTaskId);
  const { data: link, error } = await db.from("drive_raw_asset_links")
    .select("shortcut_drive_file_id").eq("workspace_id", workspace.id).eq("asset_id", assetId).maybeSingle();
  failDb(error);
  if (link && !link.shortcut_drive_file_id) throw new HttpError(409, "Este arquivo esta fisicamente na pasta Raw. Mova-o no Drive para desassociar.");
  if (link?.shortcut_drive_file_id) await setDriveItemTrashed(link.shortcut_drive_file_id, true);
  const { error: deleteError } = await db.from("drive_raw_asset_links").delete().eq("workspace_id", workspace.id).eq("asset_id", assetId);
  failDb(deleteError);
}

/** Correct a file placed in the Creative root/Preview: move it into Raw. */
export async function moveCreativeAssetToRaw(db: Db, creativeTaskId: string, assetId: string) {
  const workspace = await readyWorkspace(db, creativeTaskId);
  const { data: asset, error } = await db.from("drive_assets").select("*")
    .eq("workspace_id", workspace.id).eq("id", assetId).eq("state", "active").maybeSingle();
  failDb(error);
  if (!asset) throw new HttpError(404, "Arquivo do Criativo nao encontrado.");
  const file = await getDriveItemMetadata(asset.drive_file_id);
  if (!file) throw new HttpError(404, "Arquivo nao encontrado no Drive.");
  const from = [workspace.creative_folder_id, workspace.preview_folder_id]
    .find((folderId) => file.parents?.includes(folderId!));
  if (!from && !file.parents?.includes(workspace.raw_folder_id!)) {
    throw new HttpError(409, "O arquivo nao esta na raiz ou no Preview deste Criativo.");
  }
  if (from) await moveDriveItemBetweenFolders(file.id, from, workspace.raw_folder_id!);
  const { error: registerError } = await db.rpc("register_drive_raw_folder_asset", {
    p_workspace_id: workspace.id, p_drive_file_id: file.id, p_name: file.name,
    p_mime_type: file.mimeType, p_size_bytes: file.size, p_web_view_link: file.webViewLink,
  });
  failDb(registerError);
  return { ...asset, role: "raw" };
}

export async function promoteCreativeAsset(db: Db, userId: string, creativeTaskId: string, assetId: string) {
  const workspace = await readyWorkspace(db, creativeTaskId);
  const { data: asset, error: assetError } = await db.from("drive_assets").select("*")
    .eq("workspace_id", workspace.id).eq("id", assetId).eq("state", "active").maybeSingle();
  failDb(assetError);
  if (!asset || asset.role === "raw") throw new HttpError(400, "Somente um Preview pode virar versao final.");
  const { data: existingVersion, error: existingVersionError } = await db.from("drive_final_versions").select("*")
    .eq("workspace_id", workspace.id).eq("asset_id", assetId).maybeSingle();
  failDb(existingVersionError);
  if (existingVersion && asset.role === "final") return existingVersion;
  const file = await getDriveItemMetadata(asset.drive_file_id);
  if (!file?.parents?.some((parent) => parent === workspace.preview_folder_id || parent === workspace.creative_folder_id)) {
    throw new HttpError(409, "O arquivo ja nao esta no Preview deste Criativo.");
  }
  if (file.parents.includes(workspace.preview_folder_id!)) {
    await moveDriveItemBetweenFolders(file.id, workspace.preview_folder_id!, workspace.creative_folder_id!);
  }
  const { error: registerError } = await db.rpc("register_drive_folder_asset", {
    p_workspace_id: workspace.id, p_drive_file_id: file.id, p_name: file.name,
    p_mime_type: file.mimeType, p_size_bytes: file.size, p_web_view_link: file.webViewLink,
    p_role: "final", p_source_created_at: new Date().toISOString(), p_promoted_by: userId,
  });
  failDb(registerError);
  const { data, error } = await db.from("drive_final_versions").select("*")
    .eq("workspace_id", workspace.id).eq("asset_id", assetId).single();
  failDb(error);
  return data;
}

export async function setFinalVersionTrashed(db: Db, creativeTaskId: string, versionId: string, trashed: boolean): Promise<void> {
  const workspace = await readyWorkspace(db, creativeTaskId);
  const { data: version, error } = await db.from("drive_final_versions").select("id,asset_id,state")
    .eq("workspace_id", workspace.id).eq("id", versionId).maybeSingle();
  failDb(error);
  if (!version) throw new HttpError(404, "Versao final nao encontrada.");
  const { data: asset, error: assetError } = await db.from("drive_assets").select("drive_file_id,role")
    .eq("id", version.asset_id).maybeSingle();
  failDb(assetError);
  if (!asset) throw new HttpError(404, "Arquivo da versao nao encontrado.");
  if (asset.role === "preview") throw new HttpError(409, "Este arquivo voltou ao Preview; gerencie-o na aba Previews.");
  await setDriveItemTrashed(asset.drive_file_id, trashed);
  const now = new Date().toISOString();
  if (!trashed) {
    const { error: supersedeError } = await db.from("drive_final_versions").update({ state: "superseded" })
      .eq("workspace_id", workspace.id).eq("state", "current").neq("id", versionId);
    failDb(supersedeError);
  }
  const { error: versionUpdateError } = await db.from("drive_final_versions").update({
    state: trashed ? "trashed" : "current", trashed_at: trashed ? now : null,
  }).eq("id", versionId);
  failDb(versionUpdateError);
  const { error: assetUpdateError } = await db.from("drive_assets").update({
    state: trashed ? "trashed" : "active", trashed_at: trashed ? now : null,
  }).eq("id", version.asset_id);
  failDb(assetUpdateError);
}
