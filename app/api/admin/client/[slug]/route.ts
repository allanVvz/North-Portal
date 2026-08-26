import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, linkClientAdAccount, updateClientBundle } from "@/lib/supabase";
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
    if (body.disabled !== undefined) clientPatch.disabled = body.disabled;

    const linksPatch: Record<string, unknown> = {};
    if (body.brandUrl !== undefined) linksPatch.brand_url = asStringOrNull(body.brandUrl);
    if (body.productsUrl !== undefined) linksPatch.products_url = asStringOrNull(body.productsUrl);
    if (body.uploadsUrl !== undefined) linksPatch.uploads_url = asStringOrNull(body.uploadsUrl);

    const resultsPatch: Record<string, unknown> = {};
    if (body.insights !== undefined) resultsPatch.insights = normalizeInsights(body.insights);
    if (body.topMetrics !== undefined) resultsPatch.top_metrics = normalizeMetrics(body.topMetrics);
    if (body.reportUrl !== undefined) resultsPatch.report_url = asStringOrNull(body.reportUrl);
    if (body.feedbackUrl !== undefined) resultsPatch.feedback_url = asStringOrNull(body.feedbackUrl);

    await updateClientBundle(client.id, {
      client: clientPatch,
      links: linksPatch,
      results: resultsPatch,
      content: body.content,
      companyInfo: body.companyInfo,
      contract: body.contract,
    });

    // Ad-account mapping lives in the integrations vault, not in the client
    // bundle — best-effort so a mapping failure never loses the form edits.
    let adAccount: { ok: boolean; reason?: string } | null = null;
    if (body.adAccountId !== undefined) {
      try {
        await linkClientAdAccount(client.slug, body.adAccountId);
        adAccount = { ok: true };
      } catch (e) {
        adAccount = { ok: false, reason: e instanceof Error ? e.message : "Falha ao vincular a conta de anuncios." };
      }
    }

    return NextResponse.json({ ok: true, adAccount });
  } catch (error) {
    return apiError(error);
  }
}
