import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listResponsibilityAssignments, setResponsibilityAssignment } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { responsibilityPatchSchema } from "@/lib/validation";

// GET/PATCH /api/admin/team/responsibilities — matriz de quem cuida de qual
// frente (Edição/Captação/Roteiro/Gestor de tráfego/Aprovação).
//
// Deixou de ser cadastro puramente informativo em 2026-09-06: marcar alguém em
// `gestor_trafego` faz essa pessoa receber os relatórios das automações de
// tráfego MESMO sem estar no card (public.notify_responsibility_holders,
// migração 20260906150000). As outras quatro frentes seguem informativas — não
// sugerem nem restringem Responsável/Revisor/Aprovador nos cards.
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
