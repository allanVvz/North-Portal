import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { GED_AREAS } from "@/lib/ged/paths";
import { importClientFile } from "@/lib/northai/importFile";

export const runtime = "nodejs";

const areaKeys = GED_AREAS.map((area) => area.key) as [(typeof GED_AREAS)[number]["key"], ...(typeof GED_AREAS)[number]["key"][]];

const importSchema = z.object({
  url: z.string().url().max(2000),
  slug: z.string().min(1).max(80),
  area: z.enum(areaKeys).optional(),
});

// POST /api/admin/northai/import — copia um link do Google para os arquivos do
// cliente e devolve o texto (e os roteiros, quando é um documento).
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = importSchema.parse(await request.json());
    return NextResponse.json(await importClientFile(body), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
