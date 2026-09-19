import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createManualRecurrenceExecution, linkExistingRecurrenceExecution, linkRecurrenceExecutionAtDate } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({
  operation: z.enum(["link", "create"]).optional(),
  child_id: z.string().uuid().optional(),
  occurrence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  occurrence_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(30).optional(),
  title: z.string().trim().max(240).optional(),
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
    const body = bodySchema.parse(await request.json());
    if (body.operation === "create") {
      const dates = [...new Set(body.occurrence_dates ?? (body.occurrence_date ? [body.occurrence_date] : []))];
      if (!dates.length) throw new HttpError(400, "Informe ao menos uma data.");
      const created = [];
      for (const date of dates) created.push(await createManualRecurrenceExecution(id, date, body.title));
      return NextResponse.json({ tasks: created }, { status: 201 });
    }
    if (!body.child_id) throw new HttpError(400, "Informe o card a vincular.");
    if (body.child_id === id) throw new HttpError(400, "Um card nao pode ser pai de si mesmo.");
    if (body.occurrence_date) return NextResponse.json(await linkRecurrenceExecutionAtDate(id, body.child_id, body.occurrence_date));
    return NextResponse.json(await linkExistingRecurrenceExecution(id, body.child_id));
  } catch (error) {
    return apiError(error);
  }
}
