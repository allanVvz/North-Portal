import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishedWorkflowForKind } from "@/lib/workflows";

export async function GET() {
  try {
    await requireAdminManager();
    const db = createAdminClient();
    const [workflow, folders, plans, clients] = await Promise.all([
      publishedWorkflowForKind(db, "criativo"),
      db.from("client_drive_links").select("client_id,raw_folder_id,uploads_folder_id"),
      db.from("tasks").select("id,title,client_id,recurrence_cadence,status")
        .eq("kind", "plano_acao").not("recurrence_cadence", "is", null)
        .order("title").limit(500),
      db.from("clients").select("id,name"),
    ]);
    if (folders.error) throw folders.error;
    if (plans.error) throw plans.error;
    if (clients.error) throw clients.error;
    const names = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
    return NextResponse.json({ deliveryTypeId: workflow?.delivery_type_id ?? null,
      workflowReady: Boolean(workflow?.steps[0]?.key === "roteiro" && workflow.steps.some((step) => step.key === "captacao")),
      folders: folders.data ?? [],
      recurringPlans: (plans.data ?? []).map((plan) => ({ ...plan, kind: "plano_acao",
        clientName: names.get(plan.client_id ?? "") ?? null })),
    });
  } catch (error) {
    return apiError(error);
  }
}
