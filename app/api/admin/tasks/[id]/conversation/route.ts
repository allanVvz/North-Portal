import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { loadCardConversation } from "@/lib/cardConversationServer";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError } from "@/lib/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!UUID.test(id)) throw new HttpError(400, "ID inválido.");
    const items = await loadCardConversation(createAdminClient(), id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
