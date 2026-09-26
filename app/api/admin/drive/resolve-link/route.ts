import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth";
import { getDriveItemMetadata } from "@/lib/googleDriveApi";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import { HttpError } from "@/lib/validation";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const search = new URL(request.url).searchParams;
    const taskId = search.get("taskId") ?? "";
    const link = parseGoogleDriveUrl(search.get("url") ?? "");
    if (!UUID.test(taskId) || !link) throw new HttpError(400, "Link ou card inválido.");
    const db = createAdminClient();
    const { data: task, error: taskError } = await db.from("tasks")
      .select("id,client_id,kind").eq("id", taskId).maybeSingle();
    if (taskError) throw taskError;
    if (!task?.client_id) throw new HttpError(404, "Card não encontrado.");
    const { data: workspaces, error: workspacesError } = await db.from("drive_creative_workspaces")
      .select("id,client_id,plan_task_id,capture_task_id,creative_task_id,stage_task_id,creative_folder_id,raw_folder_id,preview_folder_id,capture_workspace:drive_capture_workspaces(script_folder_id,capture_folder_id,daily_folder_id)")
      .eq("client_id", task.client_id).eq("status", "ready");
    if (workspacesError) throw workspacesError;
    const canonicalPlans = new Map<string, { client_id: string | null; payload: Record<string, unknown> | null }>();
    if (link.kind === "document" && workspaces?.length) {
      const planIds = [...new Set(workspaces.map((workspace) => workspace.plan_task_id))];
      const { data: plans, error: plansError } = await db.from("tasks")
        .select("id,client_id,payload").in("id", planIds);
      if (plansError) throw plansError;
      for (const plan of plans ?? []) canonicalPlans.set(plan.id, plan);
    }
    for (const workspace of workspaces ?? []) {
      const direct = [workspace.plan_task_id, workspace.capture_task_id,
        workspace.creative_task_id, workspace.stage_task_id].includes(taskId);
      let related = direct;
      if (!related) {
        const { data: links, error } = await db.from("task_links").select("parent_id")
          .eq("child_id", taskId).in("parent_id", [workspace.plan_task_id, workspace.creative_task_id])
          .in("relation_kind", ["structural_member", "workflow_step"]).limit(1);
        if (error) throw error;
        related = Boolean(links?.length);
      }
      if (!related) continue;
      const capture = Array.isArray(workspace.capture_workspace) ? workspace.capture_workspace[0] : workspace.capture_workspace;
      const canonicalPlan = canonicalPlans.get(workspace.plan_task_id);
      if (link.kind === "document" && canonicalPlan && canonicalPlan.client_id === task.client_id &&
          canonicalPlan.payload?.daily_script_doc_id === link.id) {
        return NextResponse.json({ resolved: true, taskId: workspace.creative_task_id,
          source: "script", file: { id: link.id, name: "Roteiro da diária",
            mimeType: "application/vnd.google-apps.document",
            webViewLink: `https://docs.google.com/document/d/${link.id}/edit`, size: null } });
      }
      if (link.id === capture?.daily_folder_id) {
        return NextResponse.json({ resolved: true, taskId: workspace.creative_task_id, tab: "raw" });
      }
      if (link.id === workspace.raw_folder_id || link.id === workspace.preview_folder_id ||
          link.id === workspace.creative_folder_id) {
        const tab = link.id === workspace.raw_folder_id ? "classified"
          : link.id === workspace.preview_folder_id ? "preview" : "final";
        return NextResponse.json({ resolved: true, taskId: workspace.creative_task_id, tab });
      }
      const file = await getDriveItemMetadata(link.id);
      if (!file) continue;
      const source = file.id === capture?.script_folder_id || file.parents?.includes(capture?.script_folder_id ?? "") ? "script"
        : file.id === capture?.capture_folder_id || file.parents?.includes(capture?.capture_folder_id ?? "") ? "capture" : null;
      if (source) return NextResponse.json({ resolved: true, taskId: workspace.creative_task_id,
        source, file: { id: file.id, name: file.name, mimeType: file.mimeType,
          webViewLink: file.webViewLink ?? null, size: file.size ?? null } });
      const { data: asset, error: assetError } = await db.from("drive_assets")
        .select("id,role").eq("workspace_id", workspace.id).eq("drive_file_id", file.id)
        .eq("state", "active").maybeSingle();
      if (assetError) throw assetError;
      if (asset) return NextResponse.json({ resolved: true, taskId: workspace.creative_task_id,
        assetId: asset.id, tab: asset.role === "raw" ? "classified" : asset.role });
    }
    return NextResponse.json({ resolved: false });
  } catch (error) {
    return apiError(error);
  }
}
