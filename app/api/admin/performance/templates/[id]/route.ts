import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deletePerformanceTemplate, updatePerformanceTemplate } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { HttpError, performanceTemplatePatchSchema } from "@/lib/validation";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminManager();
    const { id } = await context.params;
    if (!ID_PATTERN.test(id)) throw new HttpError(400, "ID inválido.");
    const body = performanceTemplatePatchSchema.parse(await request.json());
    const template = await updatePerformanceTemplate(id, { ...body, scope: "agency", ownerProfileId: session.userId });
    return NextResponse.json(template);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!ID_PATTERN.test(id)) throw new HttpError(400, "ID inválido.");
    await deletePerformanceTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
