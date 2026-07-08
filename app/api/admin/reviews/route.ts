import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listReviewQueue } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/reviews → cross-client review queue (tasks in revisao)
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ reviews: await listReviewQueue() });
  } catch (error) {
    return apiError(error);
  }
}
