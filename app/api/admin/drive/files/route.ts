import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { isGoogleDriveConfigured, listFolderFiles } from "@/lib/googleDriveApi";

// GET /api/admin/drive/files?folderId=... — thumbnails for the folder preview
// in the client editor. Returns an empty list (not an error) when Drive is not
// configured, so the preview degrades to an empty state.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const folderId = new URL(request.url).searchParams.get("folderId");
    if (!folderId) return NextResponse.json({ configured: isGoogleDriveConfigured(), files: [] });
    return NextResponse.json({
      configured: isGoogleDriveConfigured(),
      files: await listFolderFiles(folderId),
    });
  } catch (error) {
    return apiError(error);
  }
}
