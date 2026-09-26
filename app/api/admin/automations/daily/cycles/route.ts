import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminManager } from "@/lib/supabase/auth";
import { dailyConfigSchema, dailyPieceSchema, HttpError } from "@/lib/validation";
import { prepareDailyCycle } from "@/lib/automations/dailyCycle";

const schema = z.object({
  configId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pieces: z.array(dailyPieceSchema).min(1).max(50).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdminManager();
    const configId = z.string().uuid().parse(new URL(request.url).searchParams.get("configId"));
    const db = createAdminClient();
    const { data: config, error: configError } = await db.from("automation_configs")
      .select("target_task_id,daily_config").eq("id", configId)
      .eq("automation_key", "diaria_recorrente").maybeSingle();
    if (configError) throw configError;
    if (!config?.daily_config) throw new HttpError(404, "Diária não encontrada.");
    const clientId = dailyConfigSchema.parse(config.daily_config).clientId;
    const { data: plans, error: plansError } = await db.from("tasks")
      .select("id,title,client_id,start_date,payload,created_at")
      .eq("plan_id", config.target_task_id)
      .contains("payload", { daily_config_id: configId })
      .order("created_at", { ascending: false }).limit(20);
    if (plansError) throw plansError;
    const cycles = (plans ?? []).filter((plan) => plan.client_id === clientId);
    const ids = cycles.map((plan) => plan.id);
    const { data: workspaces, error: workspaceError } = ids.length
      ? await db.from("drive_capture_workspaces")
        .select("plan_task_id,daily_folder_id,script_folder_id,capture_folder_id,status").in("plan_task_id", ids)
      : { data: [], error: null };
    if (workspaceError) throw workspaceError;
    return NextResponse.json({ cycles: cycles.map((plan) => ({
      id: plan.id,
      title: plan.title,
      date: typeof plan.payload?.occurrence_date === "string" ? plan.payload.occurrence_date : plan.start_date,
      pieceCount: Array.isArray(plan.payload?.daily_effective?.pieces) ? plan.payload.daily_effective.pieces.length : 0,
      scriptTaskId: typeof plan.payload?.daily_script_task_id === "string" ? plan.payload.daily_script_task_id : null,
      captureTaskId: typeof plan.payload?.daily_capture_task_id === "string" ? plan.payload.daily_capture_task_id : null,
      folders: (workspaces ?? []).filter((workspace) => workspace.plan_task_id === plan.id),
    })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminManager();
    const input = schema.parse(await request.json());
    const db = createAdminClient();
    const { data: config, error: configError } = await db.from("automation_configs")
      .select("daily_config").eq("id", input.configId).eq("automation_key", "diaria_recorrente")
      .eq("active", true).maybeSingle();
    if (configError) throw configError;
    if (!config?.daily_config) throw new HttpError(404, "Diária ativa não encontrada.");
    const effective = dailyConfigSchema.parse({ ...config.daily_config, ...(input.pieces ? { pieces: input.pieces } : {}) });
    const { data: executionId, error } = await db.rpc("materialize_recurring_daily", {
      p_config_id: input.configId, p_date: input.date, p_override: effective,
    });
    if (error) throw error;
    const preparation = await prepareDailyCycle(db, executionId as string);
    return NextResponse.json({ executionId, preparation }, { status: preparation.errors.length ? 207 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
