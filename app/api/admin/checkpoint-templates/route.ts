import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createCheckpointTemplate, listCheckpointTemplates } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { checkpointTemplateCreateSchema } from "@/lib/validation";

// GET /api/admin/checkpoint-templates → default checkpoint mold, ordered.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ templates: await listCheckpointTemplates() });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/checkpoint-templates → add a checkpoint to the default mold.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = checkpointTemplateCreateSchema.parse(await request.json());
    const template = await createCheckpointTemplate(body);
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
