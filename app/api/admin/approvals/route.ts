import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listApprovalQueue } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/approvals → cross-client approval queue (tasks in aprovacao/aprovado)
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ approvals: await listApprovalQueue() });
  } catch (error) {
    return apiError(error);
  }
}
