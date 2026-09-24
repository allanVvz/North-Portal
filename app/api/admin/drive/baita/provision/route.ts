import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { BAITA_DRIVE_PLAN_ID, provisionCreativeDriveWorkspace } from "@/lib/creativeDrive";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminManager } from "@/lib/supabase/auth";

export const runtime = "nodejs";

/** Provisionamento idempotente e estritamente limitado aos 8 Criativos do piloto. */
export async function POST() {
  try {
    await requireAdminManager();
    const db = createAdminClient();
    const { data: links, error } = await db.from("task_links")
      .select("child_id,tasks!task_links_child_id_fkey(kind,subtype)")
      .eq("parent_id", BAITA_DRIVE_PLAN_ID)
      .eq("relation_kind", "structural_member");
    if (error) throw error;
    const creativeIds = (links ?? []).flatMap((link) => {
      const task = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks;
      return task?.kind === "criativo" && task?.subtype === null ? [link.child_id] : [];
    });
    const results: Array<{ creativeTaskId: string; status: "ready" | "error"; error?: string }> = [];
    for (const creativeTaskId of creativeIds) {
      try {
        await provisionCreativeDriveWorkspace(db, creativeTaskId);
        results.push({ creativeTaskId, status: "ready" });
      } catch (cause) {
        results.push({ creativeTaskId, status: "error", error: cause instanceof Error ? cause.message : "Falha desconhecida." });
      }
    }
    return NextResponse.json({ planTaskId: BAITA_DRIVE_PLAN_ID, total: creativeIds.length, results }, { status: results.some((item) => item.status === "error") ? 207 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
