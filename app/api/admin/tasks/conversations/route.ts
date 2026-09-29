import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { loadCardConversation } from "@/lib/cardConversationServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const bodySchema = z.object({ taskIds: z.array(z.string().uuid()).max(100) });

/** Queue read uses the same projection as the modal and side panel. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { taskIds } = bodySchema.parse(await request.json());
    const db = createAdminClient();
    const itemsByTaskId: Record<string, Awaited<ReturnType<typeof loadCardConversation>>> = {};
    for (const taskId of [...new Set(taskIds)]) {
      try {
        itemsByTaskId[taskId] = await loadCardConversation(db, taskId);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
      }
    }
    return NextResponse.json({ itemsByTaskId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
