import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { getCreativeDriveWorkspace, provisionCreativeDriveWorkspace, resolveCreativeDriveContext } from "@/lib/creativeDrive";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID invalido.");
    const db = createAdminClient();
    // Resolve primeiro: impede consultar por tentativa um workspace fora do piloto.
    const driveContext = await resolveCreativeDriveContext(db, id);
    return NextResponse.json({ context: driveContext, workspace: await getCreativeDriveWorkspace(db, id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID invalido.");
    return NextResponse.json(await provisionCreativeDriveWorkspace(createAdminClient(), id));
  } catch (error) {
    return apiError(error);
  }
}
