import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listAdAccountOptions } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";

// GET /api/admin/ad-accounts — ad accounts already connected (Meta OAuth grant
// plus any Windsor account already mapped), for the "Vínculo de conta" picker
// in the client form. An empty list is the signal to render the
// "nenhuma conta conectada" state.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ accounts: await listAdAccountOptions() });
  } catch (error) {
    return apiError(error);
  }
}
