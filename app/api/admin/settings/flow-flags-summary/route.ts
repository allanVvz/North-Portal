import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listAllClientFlowFlags } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { anyClientHasFlowEnabled } from "@/lib/validation";

// GET /api/admin/settings/flow-flags-summary → does ANY client currently have
// Revisão/Aprovação admin-enabled? Drives whether the Kanban shows those
// columns at all on the shared cross-client board, independent of whether a
// card happens to already be sitting in either stage.
export async function GET() {
  try {
    await requireAdmin();
    const flags = await listAllClientFlowFlags();
    return NextResponse.json(anyClientHasFlowEnabled(flags.values()));
  } catch (error) {
    return apiError(error);
  }
}
