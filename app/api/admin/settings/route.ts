import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAgencyProfile, saveAgencyProfile } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { agencyProfileSchema } from "@/lib/validation";

// GET /api/admin/settings → agency profile
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ agency: await getAgencyProfile() });
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/settings → save agency profile
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const value = agencyProfileSchema.parse(await request.json());
    return NextResponse.json({ agency: await saveAgencyProfile(value) });
  } catch (error) {
    return apiError(error);
  }
}
