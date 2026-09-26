import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { ensureDailySeries } from "@/lib/automations/dailySeries";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminManager } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireAdminManager();
    const { configId } = z.object({ configId: z.string().uuid() }).parse(await request.json());
    const series = await ensureDailySeries(createAdminClient(), configId);
    return NextResponse.json(series);
  } catch (error) {
    return apiError(error);
  }
}
