import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, validateSlug } from "@/lib/validation";
import { getNorthAiClientContext } from "@/lib/northai/context";

const querySchema = z.object({ slug: z.string().min(1).max(80).transform((value) => validateSlug(value)) });

// GET /api/admin/northai/context?slug= — o contexto do cliente no Estúdio.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { slug } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const context = await getNorthAiClientContext(slug);
    if (!context) throw new HttpError(404, "Cliente nao encontrado.");
    return NextResponse.json(context);
  } catch (error) {
    return apiError(error);
  }
}
