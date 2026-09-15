import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { completeTaskCycle, getProfileName } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, recurringCompleteSchema } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    if (!idPattern.test(id)) throw new HttpError(400, "ID inválido.");
    const { expectedCycle, expectedRevision, expectedDueDate } = recurringCompleteSchema.parse(await request.json().catch(() => ({})));
    // Quem deu o check fica registrado no card (lib/cycleLog.ts).
    const name = (await getProfileName(session.userId)) ?? session.email ?? "Alguém";
    return NextResponse.json(await completeTaskCycle(id, expectedCycle, expectedRevision, expectedDueDate ?? null, { id: session.userId, name }));
  } catch (error) {
    return apiError(error);
  }
}
