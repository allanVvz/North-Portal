import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getPlanoVisibility, savePlanoVisibility } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { planoVisibilitySchema } from "@/lib/validation";

// GET /api/admin/settings/plano-visibility → platform-wide "visível para o cliente" master switch
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ enabled: await getPlanoVisibility() });
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/settings/plano-visibility → save the master switch
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const { enabled } = planoVisibilitySchema.parse(await request.json());
    return NextResponse.json({ enabled: await savePlanoVisibility(enabled) });
  } catch (error) {
    return apiError(error);
  }
}
