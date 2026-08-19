import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getPerformanceViewPrefs, savePerformanceViewPrefs } from "@/lib/supabase";
import { requireAdmin, requireAdminManager } from "@/lib/supabase/auth";
import { performanceViewPrefsSchema } from "@/lib/validation";
import type { PerformanceViewPrefs } from "@/lib/performancePrefs";

// GET: any admin (editor or gerente) reads the shared view.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getPerformanceViewPrefs());
  } catch (error) {
    return apiError(error);
  }
}

// PUT: gerente-only — matches the canEdit gate already used for Cards
// (métricas manuais/aprovações). Whatever a gerente sets here is shared by
// every admin who opens Performance > Anúncios.
export async function PUT(request: Request) {
  try {
    await requireAdminManager();
    // Shape-only validated above; sanitizePerformanceViewPrefs (called inside
    // savePerformanceViewPrefs) does the real whitelist check against known
    // metric keys before anything is persisted.
    const body = performanceViewPrefsSchema.parse(await request.json()) as Partial<PerformanceViewPrefs>;
    return NextResponse.json(await savePerformanceViewPrefs(body));
  } catch (error) {
    return apiError(error);
  }
}
