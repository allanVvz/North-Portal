import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getPortalPayload } from "@/lib/supabase";
import { validateSlug } from "@/lib/validation";

export const runtime = "edge";

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    return NextResponse.json(await getPortalPayload(validateSlug(slug)));
  } catch (error) {
    return apiError(error);
  }
}
