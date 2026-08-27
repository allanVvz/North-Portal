import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { updateTeamMemberCargo } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, teamCargoPatchSchema } from "@/lib/validation";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/admin/team/[id] — admin editando o cargo de outro perfil (tag
// livre exibida em Equipe & papéis; preenchido = aparece em "Quem Somos").
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!uuidPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { cargo } = teamCargoPatchSchema.parse(await request.json());
    await updateTeamMemberCargo(id, cargo?.trim() || null);
    return NextResponse.json({ cargo: cargo?.trim() || null });
  } catch (error) {
    return apiError(error);
  }
}
