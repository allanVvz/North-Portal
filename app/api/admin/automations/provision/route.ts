import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { automationProvisionSchema } from "@/lib/validation";
import { provisionFromTemplate } from "@/lib/automations/provision";

// POST /api/admin/automations/provision — Automação 2's synchronous fan-out,
// fired by the "Provisionar agora" button on its registered card (not by the
// cron). Clones the target card to every client with task_metrics data.
export async function POST(request: Request) {
  try {
    await requireAdminManager();
    const { templateTaskId } = automationProvisionSchema.parse(await request.json());
    return NextResponse.json(await provisionFromTemplate(templateTaskId));
  } catch (error) {
    return apiError(error);
  }
}
