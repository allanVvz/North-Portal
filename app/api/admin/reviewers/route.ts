import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, listAdminReviewers, listClientReviewerCandidates } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, validateSlug } from "@/lib/validation";

// GET /api/admin/reviewers?slug=<client>
// → adminReviewers (Revisão stage) + clientReviewers (Aprovação stage), split
// because a reviewer is never a client before Aprovação, and never an admin
// once the card is client-facing.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const slug = validateSlug(url.searchParams.get("slug") ?? "");
    const client = await getClient(slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const [adminReviewers, clientReviewers] = await Promise.all([
      listAdminReviewers(),
      listClientReviewerCandidates(client.id),
    ]);
    return NextResponse.json({ adminReviewers, clientReviewers });
  } catch (error) {
    return apiError(error);
  }
}
