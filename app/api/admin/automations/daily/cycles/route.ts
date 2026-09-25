import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminManager } from "@/lib/supabase/auth";
import { dailyConfigSchema, dailyPieceSchema, HttpError } from "@/lib/validation";

const schema = z.object({
  configId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pieces: z.array(dailyPieceSchema).min(1).max(50).optional(),
});

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
    return NextResponse.json({ executionId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
