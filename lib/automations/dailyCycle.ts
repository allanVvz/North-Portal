import { provisionCreativeDriveWorkspace } from "@/lib/creativeDrive";
import { HttpError } from "@/lib/validation";
import type { AdminClient } from "./taskAccess";
import { errorMessage } from "./taskAccess";
import { automationCommentId, updateTaskPayload } from "./taskWrites";

type DailyPlan = {
  id: string;
  kind: string;
  client_id: string | null;
  payload: Record<string, unknown> | null;
};
type DailyMember = { id: string; client_id: string | null; kind: string; payload: Record<string, unknown> | null };
type PreparedFolder = { creativeTaskId: string; rawFolderId: string };
export type DailyCyclePreparation = {
  total: number;
  prepared: number;
  errors: Array<{ creativeTaskId: string; message: string }>;
};

const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/**
 * The SQL transaction creates cards and relations. Drive is external, so it is
 * prepared afterwards and can be retried against the same execution ID.
 */
export async function prepareDailyCycle(
  admin: AdminClient,
  executionId: string,
): Promise<DailyCyclePreparation> {
  const { data: plan, error: planError } = await admin.from("tasks")
    .select("id,kind,client_id,payload").eq("id", executionId).maybeSingle();
  if (planError) throw planError;
  const daily = plan as DailyPlan | null;
  if (!daily || daily.kind !== "plano_acao" || !daily.client_id ||
      typeof daily.payload?.daily_config_id !== "string") {
    throw new HttpError(409, "Esta execução não pertence a uma diária configurada.");
  }
  const { data: links, error: linksError } = await admin.from("task_links")
    .select("child_id,position").eq("parent_id", executionId)
    .eq("relation_kind", "structural_member").order("position");
  if (linksError) throw linksError;
  const ids = (links ?? []).map((link) => link.child_id as string);
  if (!ids.length) throw new HttpError(409, "A diária ainda não possui Entregas.");
  const { data: members, error: memberError } = await admin.from("tasks")
    .select("id,client_id,kind,payload").in("id", ids);
  if (memberError) throw memberError;
  const byId = new Map(((members ?? []) as DailyMember[]).map((member) => [member.id, member]));
  if (ids.some((id) => !byId.has(id) || byId.get(id)?.client_id !== daily.client_id)) {
    throw new HttpError(409, "Os cards da diária precisam pertencer ao mesmo cliente.");
  }
  const creatives = ids.filter((id) => typeof byId.get(id)?.payload?.daily_piece_key === "string");
  if (!creatives.length) throw new HttpError(409, "A diária ainda não possui Criativos.");

  const errors: DailyCyclePreparation["errors"] = [];
  const prepared: PreparedFolder[] = [];
  let shared: { daily?: string | null; script?: string | null; capture?: string | null } | null = null;
  // Sequential provisioning reuses the same recorded Capture workspace.
  for (const creativeTaskId of creatives) {
    try {
      const workspace = await provisionCreativeDriveWorkspace(admin, creativeTaskId);
      if (workspace.status !== "ready" || !workspace.raw_folder_id) {
        throw new Error("Pasta Raw ainda não está pronta.");
      }
      prepared.push({ creativeTaskId, rawFolderId: workspace.raw_folder_id });
      shared ??= {
        daily: workspace.capture_workspace?.daily_folder_id,
        script: workspace.capture_workspace?.script_folder_id,
        capture: workspace.capture_workspace?.capture_folder_id,
      };
      await updateTaskPayload(admin, creativeTaskId, {
        text: `North AI preparou a pasta Raw desta Entrega: [abrir pasta](${folderLink(workspace.raw_folder_id)}).`,
        commentId: automationCommentId("daily-raw", executionId, creativeTaskId),
      });
    } catch (error) {
      errors.push({ creativeTaskId, message: errorMessage(error) });
    }
  }
  if (!errors.length && shared) {
    const scriptId = daily.payload?.daily_script_task_id;
    const captureId = daily.payload?.daily_capture_task_id;
    if (typeof scriptId === "string" && shared.script) {
      await updateTaskPayload(admin, scriptId, {
        text: `North AI preparou a pasta do Roteiro: [abrir pasta](${folderLink(shared.script)}).`,
        commentId: automationCommentId("daily-script-folder", executionId),
      });
    }
    if (typeof captureId === "string" && shared.capture) {
      await updateTaskPayload(admin, captureId, {
        text: `North AI preparou a pasta da Captação: [abrir pasta](${folderLink(shared.capture)}).`,
        commentId: automationCommentId("daily-capture-folder", executionId),
      });
    }
    await updateTaskPayload(admin, executionId, {
      text: `North AI preparou ${creatives.length} Entrega(s) e as pastas desta gravação${shared.daily ? `: [abrir pasta](${folderLink(shared.daily)})` : ""}.`,
      commentId: automationCommentId("daily-ready", executionId),
    });
  }
  return { total: creatives.length, prepared: prepared.length, errors };
}
