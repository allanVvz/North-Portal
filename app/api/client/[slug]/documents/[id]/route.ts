import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, markDocumentRead } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { HttpError, validateSlug } from "@/lib/validation";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/client/[slug]/documents/[id] — marks a document as read when the
// client opens its viewer modal. Body is ignored; this endpoint only ever
// sets read_at server-side.
export async function PATCH(request: Request, context: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await context.params;
    const safeSlug = validateSlug(slug);
    await requireClientAccess(safeSlug);
    if (!idPattern.test(id)) throw new HttpError(400, "ID invalido.");

    const client = await getClient(safeSlug);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");

    const updated = await markDocumentRead(id, client.id);
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
