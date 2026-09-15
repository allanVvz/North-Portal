import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAdminClientDetail, getClient } from "@/lib/supabase";
import { todayInTimezone } from "@/app/admin/recurringState";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";
import { importLinkIntoGed } from "@/lib/ged";
import { isGedArea } from "@/lib/ged/paths";
import { parseScripts } from "@/lib/northai/scriptParser";

export const runtime = "nodejs";

const importSchema = z.object({
  url: z.string().url().max(2000),
  slug: z.string().min(1).max(80),
  area: z.string().max(40).optional(),
});

// POST /api/admin/northai/import — copia um link do Google para o GED do cliente
// e devolve o texto (Docs/Sheets). Para um Docs, já separa os roteiros.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = importSchema.parse(await request.json());
    const client = await getClient(body.slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const detail = await getAdminClientDetail(body.slug);
    const result = await importLinkIntoGed({
      url: body.url,
      client: { id: client.id, slug: client.slug, name: client.name },
      area: body.area && isGedArea(body.area) ? body.area : undefined,
      driveRootFolderId: detail?.driveFolders.rootFolderId ?? null,
      today: todayInTimezone("America/Sao_Paulo"),
    });
    return NextResponse.json({
      document: { id: result.document.id, name: result.document.name, fileName: result.document.original_file_name },
      folderPath: result.folderPath,
      sourceKind: result.sourceKind,
      text: result.text,
      scripts: result.sourceKind === "document" && result.text ? parseScripts(result.text) : [],
      driveMirror: result.driveMirror,
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
