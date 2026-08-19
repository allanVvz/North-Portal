import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAiProviderSettings, maskAiProviderSettings, saveAiProviderSettings } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { aiProviderSettingsPatchSchema } from "@/lib/validation";

// GET /api/admin/settings/ai-provider → AI provider integration config,
// MASKED — the raw apiKey never leaves the server, only configured + last 4
// chars (mirrors /api/admin/settings/windsor).
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(maskAiProviderSettings(await getAiProviderSettings()));
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/settings/ai-provider → save vendor/key. requireAdmin
// (not gerente): agency-level configuration, same as every other settings route.
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const patch = aiProviderSettingsPatchSchema.parse(await request.json());
    return NextResponse.json(maskAiProviderSettings(await saveAiProviderSettings(patch)));
  } catch (error) {
    return apiError(error);
  }
}
