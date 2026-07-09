import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAdminTabsVisibility, saveAdminTabsVisibility } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { adminTabsVisibilitySchema } from "@/lib/validation";

// GET /api/admin/settings/tabs-visibility → whether "Revisões"/"Aprovações" show in the admin nav
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getAdminTabsVisibility());
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/settings/tabs-visibility → toggle either nav item on/off
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const patch = adminTabsVisibilitySchema.parse(await request.json());
    return NextResponse.json(await saveAdminTabsVisibility(patch));
  } catch (error) {
    return apiError(error);
  }
}
