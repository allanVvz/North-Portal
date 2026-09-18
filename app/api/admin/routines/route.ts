import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listRecurringTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/routines — as demandas recorrentes ativas, para o calendário do
// quadro de Tarefas (ATA 14/09: "essas tarefas são guia, devem estar no
// calendário e demais visões"). Sem as execuções: o calendário só projeta as
// datas a partir da regra do molde.
export async function GET() {
  try {
    await requireAdmin();
    const routines = await listRecurringTasks();
    // The client needs the actual child records to render a factual calendar.
    // Do not remove inactive templates: historical routines remain inspectable.
    return NextResponse.json({ tasks: routines });
  } catch (error) {
    return apiError(error);
  }
}
