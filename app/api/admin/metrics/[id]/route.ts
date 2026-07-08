import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getTaskById, upsertTaskMetrics } from "@/lib/supabase";
import { requireAdminManager } from "@/lib/supabase/auth";
import { HttpError, taskMetricsPatchSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/admin/metrics/[id] → upsert the metrics jsonb for a published
// task. Editors can view metrics (GET /api/admin/metrics) but only gerentes
// can register/edit them.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminManager();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const { metrics } = taskMetricsPatchSchema.parse(await request.json());
    const task = await getTaskById(id);
    if (!task) throw new HttpError(404, "Tarefa nao encontrada.");
    const saved = await upsertTaskMetrics(id, task.client_id, metrics);
    return NextResponse.json(saved);
  } catch (error) {
    return apiError(error);
  }
}
