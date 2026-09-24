import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { googleDriveAccessToken } from "@/lib/googleDriveApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    await requireAdmin();
    const { id, assetId } = await context.params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(assetId).success) throw new HttpError(400, "ID inválido.");
    const db = createAdminClient();
    const { data: workspace, error: workspaceError } = await db.from("drive_creative_workspaces")
      .select("id").eq("creative_task_id", id).maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace) throw new HttpError(404, "Pasta do Criativo não encontrada.");
    const { data: asset, error: assetError } = await db.from("drive_assets")
      .select("id,drive_file_id,name,mime_type,role,state").eq("workspace_id", workspace.id).eq("id", assetId).maybeSingle();
    if (assetError) throw assetError;
    if (!asset || asset.role !== "raw" || asset.state !== "active") throw new HttpError(404, "Bruto classificado não encontrado.");
    const { data: link, error: linkError } = await db.from("drive_raw_asset_links")
      .select("asset_id").eq("workspace_id", workspace.id).eq("asset_id", assetId).maybeSingle();
    if (linkError) throw linkError;
    if (!link) throw new HttpError(404, "Este bruto não está vinculado ao Criativo.");
    const token = await googleDriveAccessToken();
    if (!token) throw new HttpError(503, "Google Drive indisponível.");
    const range = request.headers.get("Range");
    const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(asset.drive_file_id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}`, ...(range && /^bytes=\d+-\d*$/.test(range) ? { Range: range } : {}) }, cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) throw new HttpError(502, `Não foi possível baixar o bruto no Drive (${upstream.status}).`);
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") ?? asset.mime_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const length = upstream.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);
    if (upstream.headers.get("Accept-Ranges")) headers.set("Accept-Ranges", "bytes");
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return apiError(error);
  }
}
