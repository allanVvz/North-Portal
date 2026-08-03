import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listAssigneeOptions } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/assignees — every Responsável option (admin team members
// union distinct historical assignee text), for the now dropdown-only field.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ assignees: await listAssigneeOptions() });
  } catch (error) {
    return apiError(error);
  }
}
