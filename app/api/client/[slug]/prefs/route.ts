import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, savePrefs } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { HttpError, prefsPatchSchema, validateSlug } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const safeSlug = validateSlug(slug);
    await requireClientAccess(safeSlug);

    const client = await getClient(safeSlug);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");

    const body = prefsPatchSchema.parse(await request.json());
    const saved = await savePrefs(client.id, body);
    return NextResponse.json(saved);
  } catch (error) {
    return apiError(error);
  }
}
