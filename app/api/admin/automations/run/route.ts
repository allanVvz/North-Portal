import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireCronSecret } from "@/lib/cron";
import { runAutomations } from "@/lib/automations/run";

// Node runtime required by @react-pdf/renderer (lib/reports/adsReportPdf.tsx).
export const runtime = "nodejs";

// POST /api/admin/automations/run — cron-only entrypoint, called by
// pg_cron/pg_net (supabase/migrations/20260820000003_automation_cron.sql).
// Gated by x-cron-secret, not a user session.
export async function POST(request: Request) {
  try {
    await requireCronSecret(request);
    const summary = await runAutomations();
    return NextResponse.json(summary);
  } catch (error) {
    return apiError(error);
  }
}
