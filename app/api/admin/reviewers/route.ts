import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getClient, listAdminReviewers, listApproverCandidates } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, validateSlug } from "@/lib/validation";

// GET /api/admin/reviewers?slug=<client>
// → adminReviewers (Revisão stage, admin-only) + clientReviewers (Aprovação
// stage: the client's own accounts, union the whole North team — a North
// teammate can also be designated as approver, not just the client).
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const slug = validateSlug(url.searchParams.get("slug") ?? "");
    const client = await getClient(slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const [adminReviewers, clientReviewers] = await Promise.all([
      listAdminReviewers(),
      listApproverCandidates(client.id),
    ]);
    return NextResponse.json({ adminReviewers, clientReviewers });
  } catch (error) {
    return apiError(error);
  }
}
