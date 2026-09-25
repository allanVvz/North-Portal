import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { syncCreativeDriveFolders } from "@/lib/creativeDriveSync";
import { applyCaptureHomeArrivals, applyEditHomeArrival, recordAudioToRaw } from "@/lib/flows/homeArrival";
import { createClient } from "@/lib/supabase/server";
import { listFolderFilesPage } from "@/lib/googleDriveApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";

export const runtime = "nodejs";

type Db = ReturnType<typeof createAdminClient>;

// A read-only index for card icons, comment attachments and covers. The files
// remain in their own workspaces; parents receive references only.
async function materialIndex(db: Db, syncWarnings: string[] = []) {
    const [workspaceResult, captureResult] = await Promise.all([db.from("drive_creative_workspaces")
      .select("id,plan_task_id,capture_task_id,creative_task_id,status,assets:drive_assets!drive_assets_workspace_id_fkey(id,drive_file_id,name,mime_type,size_bytes,role,state,web_view_link,created_at),raw_links:drive_raw_asset_links!drive_raw_asset_links_workspace_id_fkey(asset_id),final_versions:drive_final_versions!drive_final_versions_workspace_id_fkey(id,asset_id,version_number,state,promoted_at)")
      , db.from("drive_capture_workspaces")
      .select("capture_task_id,script_folder_id,capture_folder_id")
      ]);
    const { data, error } = workspaceResult;
    if (error) throw error;
    const creativeIds = [...new Set((data ?? []).map((workspace) => workspace.creative_task_id))];
    const creativeTitles = new Map<string, string>();
    if (creativeIds.length) {
      const { data: cards, error: cardsError } = await db.from("tasks").select("id,title").in("id", creativeIds);
      if (cardsError) throw cardsError;
      for (const card of cards ?? []) creativeTitles.set(card.id, card.title);
    }
    const { data: captures, error: captureError } = captureResult;
    if (captureError) throw captureError;
    const counts = new Map<string, { count: number | null; limited: boolean }>(await Promise.all((captures ?? []).map(async (capture) => {
      if (!capture.script_folder_id || !capture.capture_folder_id) return [capture.capture_task_id, { count: null, limited: false }] as const;
      try {
        const [script, raw] = await Promise.all([
          listFolderFilesPage(capture.script_folder_id, 1, null, true),
          listFolderFilesPage(capture.capture_folder_id, 1, null, true),
        ]);
        return [capture.capture_task_id, { count: script.files.length + raw.files.length, limited: Boolean(script.nextPageToken || raw.nextPageToken) }] as const;
      } catch {
        return [capture.capture_task_id, { count: null, limited: false }] as const;
      }
    })));
    return NextResponse.json({ workspaces: (data ?? []).map((workspace) => ({
      ...workspace,
      creative_title: creativeTitles.get(workspace.creative_task_id) ?? null,
      available_raw_count: counts.get(workspace.capture_task_id)?.count ?? null,
      available_raw_limited: counts.get(workspace.capture_task_id)?.limited ?? false,
    })), syncWarnings }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  try {
    await requireAdmin();
    return await materialIndex(createAdminClient());
  } catch (error) {
    return apiError(error);
  }
}

/** The UI explicitly requests reconciliation before reading the card index. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const db = createAdminClient();
    const body = await request.json().catch(() => ({})) as { taskId?: unknown };
    const taskId = typeof body.taskId === "string" && /^[0-9a-f-]{36}$/i.test(body.taskId) ? body.taskId : null;
    const { data: folders, error } = await db.from("drive_creative_workspaces")
      .select("id,plan_task_id,routine_task_id,capture_task_id,capture_workspace_id,creative_task_id,stage_task_id,creative_folder_id,raw_folder_id,preview_folder_id,status,last_error")
      .eq("status", "ready");
    if (error) throw error;
    const relevant = (folders ?? []).filter((folder) => !taskId || [
      folder.routine_task_id, folder.plan_task_id, folder.capture_task_id,
      folder.creative_task_id, folder.stage_task_id,
    ].includes(taskId));
    const results = await Promise.allSettled(relevant.map((folder) => syncCreativeDriveFolders(db, folder)));
    const warnings = results.flatMap((result, index) => result.status === "rejected"
      ? [`${relevant[index].creative_task_id}: ${result.reason instanceof Error ? result.reason.message : "Falha ao sincronizar o Drive."}`] : []);
    // Arquivo novo na Home da etapa → Revisão (lib/flows/homeArrival.ts):
    // Edição por criativo; Roteiro e Captação pelas pastas da diária. Falha
    // aqui vira aviso, nunca derruba a leitura dos materiais.
    const session = await createClient();
    const arrivals = await Promise.allSettled([
      ...results.map((result, index) => result.status === "fulfilled"
        ? applyEditHomeArrival(db, session, { creativeTaskId: relevant[index].creative_task_id, stageTaskId: relevant[index].stage_task_id, files: result.value.newHomeFiles })
        : Promise.resolve(false)),
      ...results.map((result, index) => result.status === "fulfilled"
        ? recordAudioToRaw(db, { creativeTaskId: relevant[index].creative_task_id, stageTaskId: relevant[index].stage_task_id, files: result.value.audioToRaw })
        : Promise.resolve()),
      ...[...new Set(relevant.map((folder) => folder.capture_workspace_id).filter(Boolean))].map((captureId) => applyCaptureHomeArrivals(db, captureId)),
    ]);
    for (const arrival of arrivals) {
      if (arrival.status === "rejected") warnings.push(`Revisão automática: ${arrival.reason instanceof Error ? arrival.reason.message : "falha ao aplicar."}`);
    }
    return await materialIndex(db, warnings);
  } catch (error) {
    return apiError(error);
  }
}
