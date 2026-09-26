import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { resolveCreativeDriveContext } from "@/lib/creativeDrive";
import { listFolderFilesPage } from "@/lib/googleDriveApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read another page only from this creative's recorded capture folders. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID inválido.");
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const pageToken = url.searchParams.get("pageToken");
    const query = url.searchParams.get("query")?.trim() ?? "";
    if (kind !== "script" && kind !== "capture") throw new HttpError(400, "Origem inválida.");
    if ((!pageToken && !query) || (pageToken && pageToken.length > 4096)) throw new HttpError(400, "Página inválida.");
    if (query && (query.length < 2 || query.length > 120)) throw new HttpError(400, "Busca deve ter de 2 a 120 caracteres.");
    const db = createAdminClient();
    const driveContext = await resolveCreativeDriveContext(db, id);
    const { data, error } = await db.from("drive_capture_workspaces")
      .select("script_folder_id,capture_folder_id")
      .eq("plan_task_id", driveContext.planTaskId)
      .eq("capture_task_id", driveContext.captureTaskId)
      .maybeSingle();
    if (error) throw error;
    const folderId = kind === "script" ? data?.script_folder_id : data?.capture_folder_id;
    if (!folderId) throw new HttpError(409, "A pasta da Captação ainda não está pronta.");
    const page = await listFolderFilesPage(folderId, 1000, pageToken, true, query);
    return NextResponse.json({ ...page, files: page.files.filter((file) =>
      file.mimeType !== "application/vnd.google-apps.shortcut" &&
      file.mimeType !== "application/vnd.google-apps.folder") },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
