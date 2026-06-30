import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, saveBriefing } from "@/lib/supabase";
import { HttpError, briefingPatchSchema, normalizeBoolean, validateSlug } from "@/lib/validation";

export const runtime = "edge";

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const client = await getClient(validateSlug(slug));
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");

    const body = briefingPatchSchema.parse(await request.json());
    const saved = await saveBriefing(client.id, body.answers, normalizeBoolean(body.submitted));
    return NextResponse.json({
      answers: saved.answers ?? {},
      submitted: Boolean(saved.submitted),
      updatedAt: saved.updated_at ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}
