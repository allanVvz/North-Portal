import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listResponsibilityAssignments, setResponsibilityAssignment } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { responsibilityPatchSchema } from "@/lib/validation";

// GET/PATCH /api/admin/team/responsibilities — matriz de quem cuida de qual
// frente (Edição/Captação/Roteiro/Métricas/Aprovação). Cadastro informativo
// em Configurações por enquanto — não influencia nenhum picker de
// Responsável/Revisor/Aprovador nos cards.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await listResponsibilityAssignments());
  } catch (error) {
    return apiError(error);
  }
}

// Liga/desliga uma atribuição por vez — mesmo padrão de toggle unitário do
// resto de Configurações, não substitui a matriz inteira.
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const { responsibility, profileId, assigned } = responsibilityPatchSchema.parse(await request.json());
    await setResponsibilityAssignment(responsibility, profileId, assigned);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
