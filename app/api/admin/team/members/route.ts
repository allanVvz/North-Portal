import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listTeamMembers } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/team/members — a equipe North para o autocomplete de @menção
// nos comentários. Só nome e id: é o que o campo precisa, e nada de cliente.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ members: await listTeamMembers() });
  } catch (error) {
    return apiError(error);
  }
}
