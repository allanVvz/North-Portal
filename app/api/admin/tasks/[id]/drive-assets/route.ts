import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  canManageCreativeAssets,
  completeCreativeUpload,
  getCreativeDriveWorkspace,
  linkRawAsset,
  promoteCreativeAsset,
  resolveCreativeDriveContext,
  setFinalVersionTrashed,
  startCreativeUpload,
  unlinkRawAsset,
} from "@/lib/creativeDrive";
import { getDriveItemMetadata } from "@/lib/googleDriveApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_upload"), name: z.string().trim().min(1).max(240), mimeType: z.string().min(1).max(160), size: z.number().int().min(1).max(5 * 1024 * 1024 * 1024) }),
  z.object({ action: z.literal("complete_upload"), driveFileId: z.string().min(3).max(200) }),
  z.object({ action: z.literal("link_raw"), driveFileId: z.string().min(3).max(200), name: z.string().min(1).max(240), mimeType: z.string().max(160), webViewLink: z.string().url().nullable().optional() }),
  z.object({ action: z.literal("unlink_raw"), assetId: z.string().uuid() }),
  z.object({ action: z.literal("promote"), assetId: z.string().uuid() }),
  z.object({ action: z.literal("trash_final"), versionId: z.string().uuid() }),
  z.object({ action: z.literal("restore_final"), versionId: z.string().uuid() }),
]);

/** Read-only classification preflight for files shown in the current workspace. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID invalido.");
    const fileId = new URL(request.url).searchParams.get("fileId");
    if (!fileId || !/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) throw new HttpError(400, "Arquivo invalido.");
    const db = createAdminClient();
    await resolveCreativeDriveContext(db, id);
    const workspace = await getCreativeDriveWorkspace(db, id);
    if (!workspace) throw new HttpError(404, "Workspace nao encontrado.");
    const source = [...workspace.source_files.script, ...workspace.source_files.capture].find((file) => file.id === fileId);
    if (!source) throw new HttpError(404, "Arquivo nao encontrado na primeira pagina de brutos.");
    const metadata = await getDriveItemMetadata(fileId);
    const allowedParents = [workspace.capture_workspace?.script_folder_id, workspace.capture_workspace?.capture_folder_id];
    return NextResponse.json({
      payloadValid: bodySchema.safeParse({ action: "link_raw", driveFileId: source.id, name: source.name, mimeType: source.mimeType, webViewLink: source.webViewLink }).success,
      metadataAccessible: Boolean(metadata),
      parentMatches: Boolean(metadata?.parents?.some((parent) => allowedParents.includes(parent))),
      metadataIsShortcut: metadata?.mimeType === "application/vnd.google-apps.shortcut",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID invalido.");
    const input = bodySchema.parse(await request.json());
    const db = createAdminClient();
    const driveContext = await resolveCreativeDriveContext(db, id);
    // Classificação equivale a organizar materiais do card: todos os editores
    // administrativos já podem editar o card. Upload e finais seguem restritos.
    const classifyingRaw = input.action === "link_raw" || input.action === "unlink_raw";
    if (!classifyingRaw && !(await canManageCreativeAssets(db, session.userId, session.level, driveContext))) {
      throw new HttpError(403, "Somente um responsavel pelo Criativo ou pela Edicao pode alterar estes arquivos.");
    }
    switch (input.action) {
      case "start_upload":
        return NextResponse.json(await startCreativeUpload(db, session.userId, id, input));
      case "complete_upload":
        return NextResponse.json(await completeCreativeUpload(db, session.userId, id, input.driveFileId));
      case "link_raw":
        return NextResponse.json(await linkRawAsset(db, session.userId, id, {
          id: input.driveFileId, name: input.name, mimeType: input.mimeType,
          size: null, webViewLink: input.webViewLink ?? null,
        }));
      case "unlink_raw":
        await unlinkRawAsset(db, id, input.assetId);
        return NextResponse.json({ ok: true });
      case "promote":
        return NextResponse.json(await promoteCreativeAsset(db, session.userId, id, input.assetId));
      case "trash_final":
        await setFinalVersionTrashed(db, id, input.versionId, true);
        return NextResponse.json({ ok: true });
      case "restore_final":
        await setFinalVersionTrashed(db, id, input.versionId, false);
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return apiError(error);
  }
}
