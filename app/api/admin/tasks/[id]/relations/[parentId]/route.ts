import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { detachTaskRelation } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string; parentId: string }> },
) {
  try {
    await requireAdmin();
    const { id, parentId } = await context.params;
    if (!idPattern.test(id) || !idPattern.test(parentId)) throw new HttpError(400, "ID invalido.");
    return NextResponse.json(await detachTaskRelation(id, parentId));
  } catch (error) {
    return apiError(error);
  }
}
