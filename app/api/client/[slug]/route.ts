import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getPortalPayload } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { validateSlug } from "@/lib/validation";

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const safeSlug = validateSlug(slug);
    const session = await requireClientAccess(safeSlug);
    const payload = await getPortalPayload(safeSlug);
    return NextResponse.json({ ...payload, sessionUserId: session.userId, sessionLevel: session.level });
  } catch (error) {
    return apiError(error);
  }
}
