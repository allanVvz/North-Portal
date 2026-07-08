import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, upsertClientCredential } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { credentialPatchSchema, HttpError, validateSlug } from "@/lib/validation";

// PUT /api/client/[slug]/credentials — register/update a platform login.
// Basic (offline) validation only — no live check against the platform,
// by explicit product decision. A blank password keeps the current one.
// Acessos & Pastas is dev-only for now — the Next.js page-level lock covers
// normal navigation, but this write endpoint carries real credentials, so it
// gets its own hard block against being hit directly in a deployed build.
export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    if (process.env.NODE_ENV === "production") throw new HttpError(404, "Recurso nao disponivel.");
    const { slug } = await context.params;
    const safeSlug = validateSlug(slug);
    await requireClientAccess(safeSlug);

    const client = await getClient(safeSlug);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");

    const body = credentialPatchSchema.parse(await request.json());
    const saved = await upsertClientCredential(client.id, body);
    return NextResponse.json(saved);
  } catch (error) {
    return apiError(error);
  }
}
