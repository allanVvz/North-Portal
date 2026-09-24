import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  canManageCreativeAssets,
  completeCreativeUpload,
  linkRawAsset,
  promoteCreativeAsset,
  resolveCreativeDriveContext,
  setFinalVersionTrashed,
  startCreativeUpload,
  unlinkRawAsset,
} from "@/lib/creativeDrive";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_upload"), name: z.string().trim().min(1).max(240), mimeType: z.string().min(1).max(160), size: z.number().int().min(1).max(5 * 1024 * 1024 * 1024) }),
  z.object({ action: z.literal("complete_upload"), driveFileId: z.string().min(3).max(200) }),
  z.object({ action: z.literal("link_raw"), driveFileId: z.string().min(3).max(200), name: z.string().min(1).max(240), mimeType: z.string().max(160), webViewLink: z.string().url().nullable().optional() }),
  z.object({ action: z.literal("unlink_raw"), assetId: z.string().uuid() }),
  z.object({ action: z.literal("promote"), assetId: z.string().uuid() }),
  z.object({ action: z.literal("trash_final"), versionId: z.string().uuid() }),
  z.object({ action: z.literal("restore_final"), versionId: z.string().uuid() }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID invalido.");
    const input = bodySchema.parse(await request.json());
    const db = createAdminClient();
    const driveContext = await resolveCreativeDriveContext(db, id);
    if (!(await canManageCreativeAssets(db, session.userId, session.level, driveContext))) {
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
