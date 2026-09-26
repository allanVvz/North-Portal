import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { requireAdminManager } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireAdminManager();
    const planId = new URL(request.url).searchParams.get("planId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new HttpError(400, "Plano inválido.");
    const db = createAdminClient();
    const [planResult, linksResult, captureResult, creativeResult] = await Promise.all([
      db.from("tasks").select("id,title,kind,client_id").eq("id", planId).maybeSingle(),
      db.from("task_links").select("child_id,position").eq("parent_id", planId).eq("relation_kind", "structural_member").order("position"),
      db.from("drive_capture_workspaces").select("capture_task_id,daily_folder_id,script_folder_id,capture_folder_id").eq("plan_task_id", planId),
      db.from("drive_creative_workspaces").select("creative_task_id,creative_folder_id,raw_folder_id,preview_folder_id").eq("plan_task_id", planId),
    ]);
    if (planResult.error) throw planResult.error;
    if (linksResult.error) throw linksResult.error;
    if (captureResult.error) throw captureResult.error;
    if (creativeResult.error) throw creativeResult.error;
    const plan = planResult.data;
    if (!plan || plan.kind !== "plano_acao") throw new HttpError(404, "Plano não encontrado.");
    const ids = (linksResult.data ?? []).map((link) => link.child_id);
    const { data: cards, error: cardsError } = ids.length
      ? await db.from("tasks").select("id,title,kind,subtype,client_id,payload").in("id", ids)
      : { data: [], error: null };
    if (cardsError) throw cardsError;
    const ordered = ids.map((id) => (cards ?? []).find((card) => card.id === id)).filter(Boolean);
    if (ordered.some((card) => card?.client_id !== plan.client_id)) {
      throw new HttpError(409, "A execução contém card de outro cliente.");
    }
    return NextResponse.json({ plan, cards: ordered,
      captures: captureResult.data ?? [], creatives: creativeResult.data ?? [] });
  } catch (error) {
    return apiError(error);
  }
}
