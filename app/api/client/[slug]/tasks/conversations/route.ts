import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { loadCardConversation } from "@/lib/cardConversationServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireClientAccess } from "@/lib/supabase/auth";
import { getClient } from "@/lib/supabase";
import { HttpError, validateSlug } from "@/lib/validation";

const bodySchema = z.object({ taskIds: z.array(z.string().uuid()).max(100) });

/** Batch read for portal cards. Each projection is scoped to the exact signed-in
 * client before its task graph, events, comments and files are aggregated. */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const safeSlug = validateSlug(slug);
    const session = await requireClientAccess(safeSlug);
    const client = await getClient(safeSlug, session.role === "admin");
    if (!client || (session.role === "client" && session.clientId !== client.id)) throw new HttpError(404, "Cliente não encontrado.");
    const { taskIds } = bodySchema.parse(await request.json());
    const db = createAdminClient();
    const itemsByTaskId: Record<string, Awaited<ReturnType<typeof loadCardConversation>>> = {};
    for (const taskId of [...new Set(taskIds)]) {
      try {
        itemsByTaskId[taskId] = await loadCardConversation(db, taskId, { clientId: client.id });
      } catch (error) {
        // A requested card that is no longer visible/owned is omitted, so the
        // response never reveals whether a foreign card exists.
        if (!(error instanceof Error) || !("status" in error) || (error as { status?: number }).status !== 404) throw error;
      }
    }
    return NextResponse.json({ itemsByTaskId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
