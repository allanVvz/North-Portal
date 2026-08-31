import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createNorthTrilha, listNorthTrilhas } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { northTrilhaCreateSchema } from "@/lib/validation";

// GET /api/admin/north-trilhas → a lista global de Trilhas North, por posição.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ trilhas: await listNorthTrilhas() });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/north-trilhas → adiciona uma apresentação HTML ou um vídeo do
// YouTube ao fim da fila.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = northTrilhaCreateSchema.parse(await request.json());
    const trilha = await createNorthTrilha(body);
    return NextResponse.json(trilha, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
