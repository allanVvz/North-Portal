import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { deleteAutomationConfig, updateAutomationConfig } from "@/lib/supabase";
import { requireAdminManager } from "@/lib/supabase/auth";
import { automationConfigPatchSchema } from "@/lib/validation";

// PATCH /api/admin/automations/[id] — update a registered automation.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminManager();
    const { id } = await params;
    const patch = automationConfigPatchSchema.parse(await request.json());
    return NextResponse.json(await updateAutomationConfig(id, patch));
  } catch (error) {
    return apiError(error);
  }
}

// DELETE /api/admin/automations/[id] — remove a registered automation.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminManager();
    const { id } = await params;
    await deleteAutomationConfig(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
