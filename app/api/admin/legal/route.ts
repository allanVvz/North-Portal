import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listLegalDocs } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/legal → legal documents (Políticas)
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ docs: await listLegalDocs() });
  } catch (error) {
    return apiError(error);
  }
}
