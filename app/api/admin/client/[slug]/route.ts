import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, supabaseRest } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import {
  HttpError,
  adminPatchSchema,
  asOptionalString,
  asStringOrNull,
  normalizeBoolean,
  normalizeInsights,
  normalizeMetrics,
  validateSlug,
} from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    await requireAdmin();

    const { slug } = await context.params;
    const client = await getClient(validateSlug(slug), true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const body = adminPatchSchema.parse(await request.json());

    const clientPatch: Record<string, unknown> = {};
    if (body.name !== undefined) clientPatch.name = asOptionalString(body.name);
    if (body.is_active !== undefined) clientPatch.is_active = normalizeBoolean(body.is_active, client.is_active);
    if (Object.keys(clientPatch).length) {
      clientPatch.updated_at = new Date().toISOString();
      await supabaseRest(`clients?id=eq.${client.id}`, { method: "PATCH", body: JSON.stringify(clientPatch) });
    }

    const linksPatch: Record<string, unknown> = {};
    if (body.brandUrl !== undefined) linksPatch.brand_url = asStringOrNull(body.brandUrl);
    if (body.productsUrl !== undefined) linksPatch.products_url = asStringOrNull(body.productsUrl);
    if (body.uploadsUrl !== undefined) linksPatch.uploads_url = asStringOrNull(body.uploadsUrl);
    if (Object.keys(linksPatch).length) {
      linksPatch.updated_at = new Date().toISOString();
      await supabaseRest(`client_drive_links?client_id=eq.${client.id}`, { method: "PATCH", body: JSON.stringify(linksPatch) });
    }

    const resultsPatch: Record<string, unknown> = {};
    if (body.insights !== undefined) resultsPatch.insights = normalizeInsights(body.insights);
    if (body.topMetrics !== undefined) resultsPatch.top_metrics = normalizeMetrics(body.topMetrics);
    if (body.reportUrl !== undefined) resultsPatch.report_url = asStringOrNull(body.reportUrl);
    if (body.feedbackUrl !== undefined) resultsPatch.feedback_url = asStringOrNull(body.feedbackUrl);
    if (Object.keys(resultsPatch).length) {
      resultsPatch.updated_at = new Date().toISOString();
      await supabaseRest(`client_results?client_id=eq.${client.id}`, { method: "PATCH", body: JSON.stringify(resultsPatch) });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
