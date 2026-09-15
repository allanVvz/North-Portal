import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, slugSchema } from "@/lib/validation";
import { getNorthAiClientContext } from "@/lib/northai/context";

const querySchema = z
  .object({ clientId: z.string().uuid().optional(), slug: slugSchema.optional() })
  .refine((query) => Boolean(query.clientId) !== Boolean(query.slug), "Informe clientId ou slug.");

// GET /api/admin/northai/context?clientId= (ou ?slug=) — o contexto do cliente no Estúdio.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const context = await getNorthAiClientContext(query);
    if (!context) throw new HttpError(404, "Cliente nao encontrado.");
    return NextResponse.json(context);
  } catch (error) {
    return apiError(error);
  }
}
