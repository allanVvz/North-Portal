import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getWindsorSettings, maskWindsorSettings, saveWindsorSettings } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { windsorSettingsPatchSchema } from "@/lib/validation";

// GET /api/admin/settings/windsor → Windsor.ai integration config, MASKED —
// the raw apiKey never leaves the server, only configured + last 4 chars.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(maskWindsorSettings(await getWindsorSettings()));
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/settings/windsor → save key/datasources/account mapping.
// requireAdmin (not gerente): consistent with every other settings route —
// this is agency-level configuration, not a metrics write.
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const patch = windsorSettingsPatchSchema.parse(await request.json());
    return NextResponse.json(maskWindsorSettings(await saveWindsorSettings(patch)));
  } catch (error) {
    return apiError(error);
  }
}
