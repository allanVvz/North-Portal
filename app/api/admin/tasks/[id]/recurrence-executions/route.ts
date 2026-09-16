import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { linkExistingRecurrenceExecution } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({
  child_id: z.string().uuid(),
});

// POST /api/admin/tasks/[id]/recurrence-executions -> vincula um card JÁ
// EXISTENTE como execução do ciclo corrente desta recorrência ([id] = o
// molde). Irmã da rota .../relations (que liga por task_links, para Plano e
// etapas de fluxo) — esta existe à parte porque o elo de recorrência é
// `plan_id`/payload, um mecanismo diferente (ver lib/supabase.ts,
// linkExistingRecurrenceExecution).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const { child_id } = bodySchema.parse(await request.json());
    if (child_id === id) throw new HttpError(400, "Um card nao pode ser pai de si mesmo.");
    return NextResponse.json(await linkExistingRecurrenceExecution(id, child_id));
  } catch (error) {
    return apiError(error);
  }
}
