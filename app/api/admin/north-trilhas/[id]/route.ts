import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteNorthTrilha, updateNorthTrilha } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, northTrilhaPatchSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH edita título/etapa/descrição ou grava uma nova `position` (reordenação).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const patch = northTrilhaPatchSchema.parse(await request.json());
    const trilha = await updateNorthTrilha(id, patch);
    return NextResponse.json(trilha);
  } catch (error) {
    return apiError(error);
  }
}

// DELETE remove uma trilha (e seu arquivo no storage). Recusa a linha 'manual'.
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    await deleteNorthTrilha(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
