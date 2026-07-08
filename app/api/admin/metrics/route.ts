import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listPublishedTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/metrics → cross-client feed of published (Publicado) cards + their metrics
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ tasks: await listPublishedTasks() });
  } catch (error) {
    return apiError(error);
  }
}
