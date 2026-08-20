import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createPerformanceTemplate, listPerformanceTemplates } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { performanceTemplateCreateSchema } from "@/lib/validation";
import { BUILTIN_PERFORMANCE_TEMPLATES } from "@/lib/performanceTemplates";

export async function GET() {
  try {
    await requireAdmin();
    const custom = await listPerformanceTemplates();
    return NextResponse.json({ templates: [...BUILTIN_PERFORMANCE_TEMPLATES, ...custom] });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdminManager();
    const body = performanceTemplateCreateSchema.parse(await request.json());
    const template = await createPerformanceTemplate({ ...body, scope: "agency", ownerProfileId: session.userId });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
