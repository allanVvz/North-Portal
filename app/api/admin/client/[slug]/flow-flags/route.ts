import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, getClientFlowFlags, saveClientFlowFlags } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, clientFlowFlagsPatchSchema, validateSlug } from "@/lib/validation";

// GET /api/admin/client/[slug]/flow-flags → this client's Revisão/Aprovação flags
export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await context.params;
    const client = await getClient(validateSlug(slug), true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    return NextResponse.json(await getClientFlowFlags(client.id));
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/client/[slug]/flow-flags → toggle a stage on/off for admin/cliente
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();
    const { slug } = await context.params;
    const client = await getClient(validateSlug(slug), true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const patch = clientFlowFlagsPatchSchema.parse(await request.json());
    return NextResponse.json(await saveClientFlowFlags(client.id, patch));
  } catch (error) {
    return apiError(error);
  }
}
