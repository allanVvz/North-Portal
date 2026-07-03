import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getPortalPayload } from "@/lib/supabase";
import { requireClientAccess } from "@/lib/supabase/auth";
import { validateSlug } from "@/lib/validation";

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const safeSlug = validateSlug(slug);
    await requireClientAccess(safeSlug);
    return NextResponse.json(await getPortalPayload(safeSlug));
  } catch (error) {
    return apiError(error);
  }
}
