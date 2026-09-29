import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import { runDriveMaintenance } from "@/lib/driveMaintenance";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/admin/drive/maintenance { apply?: boolean } — ver lib/driveMaintenance.ts.
// Sem `apply` é simulação: só lê e diz o que faria. Restrita a gerentes.
export async function POST(request: Request) {
  try {
    await requireAdminManager();
    if (!isGoogleDriveConfigured()) throw new HttpError(503, "A integração com Google Drive não está configurada.");
    const { apply } = z.object({ apply: z.boolean().optional() }).parse(await request.json().catch(() => ({})));
    return NextResponse.json(await runDriveMaintenance(createAdminClient(), { apply: apply === true }));
  } catch (error) {
    return apiError(error);
  }
}
