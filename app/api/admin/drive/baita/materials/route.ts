import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { BAITA_DRIVE_PLAN_ID } from "@/lib/creativeDrive";
import { listFolderFiles } from "@/lib/googleDriveApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";

export const runtime = "nodejs";

// A read-only index for card icons, comment attachments and covers. The files
// remain in their own workspaces; parents receive references only.
export async function GET() {
  try {
    await requireAdmin();
    const db = createAdminClient();
    const { data, error } = await db.from("drive_creative_workspaces")
      .select("id,plan_task_id,capture_task_id,creative_task_id,status,assets:drive_assets!drive_assets_workspace_id_fkey(id,drive_file_id,name,mime_type,size_bytes,role,state,web_view_link,created_at),raw_links:drive_raw_asset_links!drive_raw_asset_links_workspace_id_fkey(asset_id),final_versions:drive_final_versions!drive_final_versions_workspace_id_fkey(id,asset_id,version_number,state,promoted_at)")
      .eq("plan_task_id", BAITA_DRIVE_PLAN_ID);
    if (error) throw error;
    const { data: captures, error: captureError } = await db.from("drive_capture_workspaces")
      .select("capture_task_id,script_folder_id,capture_folder_id")
      .eq("plan_task_id", BAITA_DRIVE_PLAN_ID);
    if (captureError) throw captureError;
    const counts = new Map<string, { count: number | null; limited: boolean }>(await Promise.all((captures ?? []).map(async (capture) => {
      if (!capture.script_folder_id || !capture.capture_folder_id) return [capture.capture_task_id, { count: null, limited: false }] as const;
      try {
        const [script, raw] = await Promise.all([
          listFolderFiles(capture.script_folder_id, 200, true),
          listFolderFiles(capture.capture_folder_id, 200, true),
        ]);
        return [capture.capture_task_id, { count: script.length + raw.length, limited: script.length === 200 || raw.length === 200 }] as const;
      } catch {
        return [capture.capture_task_id, { count: null, limited: false }] as const;
      }
    })));
    return NextResponse.json({ workspaces: (data ?? []).map((workspace) => ({
      ...workspace,
      available_raw_count: counts.get(workspace.capture_task_id)?.count ?? null,
      available_raw_limited: counts.get(workspace.capture_task_id)?.limited ?? false,
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
