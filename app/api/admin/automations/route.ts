import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createAutomationConfig, listAutomationConfigs } from "@/lib/supabase";
import { requireAdminManager } from "@/lib/supabase/auth";
import { automationConfigCreateSchema } from "@/lib/validation";

// GET /api/admin/automations — every automation registered manually
// (v2: one row per target card, no more agency/client scope).
export async function GET() {
  try {
    await requireAdminManager();
    return NextResponse.json({ automations: await listAutomationConfigs() });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/automations — register a new automation on a target card.
export async function POST(request: Request) {
  try {
    const session = await requireAdminManager();
    const body = automationConfigCreateSchema.parse(await request.json());
    return NextResponse.json(await createAutomationConfig(body, session.userId), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
