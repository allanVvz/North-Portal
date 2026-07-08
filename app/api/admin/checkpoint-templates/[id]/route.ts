import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteCheckpointTemplate, updateCheckpointTemplate } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, checkpointTemplatePatchSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    const patch = checkpointTemplatePatchSchema.parse(await request.json());
    const template = await updateCheckpointTemplate(id, patch);
    return NextResponse.json(template);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");
    await deleteCheckpointTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
