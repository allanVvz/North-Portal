import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { updateLegalDoc } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, legalDocPatchSchema } from "@/lib/validation";

const SLUGS = new Set(["privacidade", "termos", "cookies"]);

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await context.params;
    if (!SLUGS.has(slug)) throw new HttpError(400, "Documento invalido.");
    const patch = legalDocPatchSchema.parse(await request.json());
    const doc = await updateLegalDoc(slug, patch);
    return NextResponse.json(doc);
  } catch (error) {
    return apiError(error);
  }
}
