import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createScopeTag, listScopeTags } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { scopeTagCreateSchema } from "@/lib/validation";

// Catálogo de tags de escopo contratado. POST is idempotent by key, so the
// "+ Nova tag" chip can re-send an existing label without erroring.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ tags: await listScopeTags() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = scopeTagCreateSchema.parse(await request.json());
    return NextResponse.json({ tag: await createScopeTag(body) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
