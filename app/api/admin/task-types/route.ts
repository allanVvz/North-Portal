import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listTaskTypes } from "@/lib/taskTypes";

// GET /api/admin/task-types -> o vocabulario inteiro (tipos + subtipos), para
// os dropdowns de Tipo/Subtipo e para a caixa de etapas do modal. Uma consulta
// so: tipos e subtipos moram na mesma tabela.
export async function GET() {
  try {
    await requireAdmin();
    const supabase = await createClient();
    return NextResponse.json({ types: await listTaskTypes(supabase) });
  } catch (error) {
    return apiError(error);
  }
}
