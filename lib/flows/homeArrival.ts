// Arquivo novo na "Home" da etapa → a etapa vai para Revisão (25/09).
//
// Regra do usuário: quando um arquivo chega à Home do card e a etapa está em
// Entrada ou Em produção, o card vai para Revisão, com comentário no nome do
// responsável da etapa (North Ai se não houver). Cada etapa tem a sua Home:
//   - Edição   → a raiz da pasta do CRIATIVO (onde ficam os finais). A Edição
//                é compartilhada entre criativos, então a mudança vale só
//                para o criativo que recebeu o arquivo (status por Entrega);
//   - Roteiro  → a pasta Roteiro da diária;
//   - Captação → a pasta Captação da diária.
// Roteiro e Captação são da diária inteira, então a mudança é da etapa.
//
// Não há webhook do Drive: tudo isto roda quando a sincronização roda, ao
// abrir o card ou os materiais. Um arquivo posto direto no Google Drive só é
// percebido na próxima abertura.
//
// Sem loop: voltar a Edição para produção devolve os finais para Preview e a
// Home esvazia; em Roteiro/Captação, o que já foi visto fica registrado em
// `drive_capture_workspaces.*_seen_file_ids`.

import type { AdminClient } from "@/lib/automations/taskAccess";
import { transitionTaskStatus } from "@/lib/automations/taskWrites";
import { directFiles } from "@/lib/creativeDriveSync";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import type { TaskRecord } from "@/lib/validation";
import { recordStatusComment, resolveStepResponsible, stableCommentId, statusChangeText, stepLabelOf } from "./statusComments";

/** A sessão de quem abriu o card: `set_delivery_stage_status` exige `is_admin()`,
 *  que lê o usuário logado — o cliente de serviço seria recusado. */
type SessionDb = Pick<AdminClient, "rpc">;
/** Só o que a regra usa: quem chegou e com que nome. */
type ArrivedFile = { id: string; name: string };
type Status = TaskRecord["status"];
type Stage = { id: string; status: Status; subtype: string | null; title: string | null; assignee: string | null };

const OPEN = new Set<Status>(["backlog", "em_producao"]);

async function readStage(admin: AdminClient, stageId: string): Promise<Stage | null> {
  const { data, error } = await admin.from("tasks").select("id,status,subtype,title,assignee").eq("id", stageId).maybeSingle();
  if (error) throw error;
  return (data as Stage | null) ?? null;
}

const names = (files: readonly ArrivedFile[]) => files.map((file) => file.name).join(", ");

/** Criativos cuja Edição anda junto com a etapa (sem andamento próprio). Uma
 *  mudança da etapa inteira só alcança esses. */
export async function creativesFollowingStage(admin: AdminClient, stageTaskId: string): Promise<string[]> {
  const { data, error } = await admin.from("task_links").select("parent_id,status_override")
    .eq("child_id", stageTaskId).eq("relation_kind", "workflow_step");
  if (error) throw error;
  return ((data ?? []) as { parent_id: string; status_override: string | null }[])
    .filter((link) => link.status_override === null).map((link) => link.parent_id);
}

/** Edição: arquivo novo na Home do criativo. Devolve se a etapa mudou. */
export async function applyEditHomeArrival(
  admin: AdminClient,
  sessionDb: SessionDb,
  input: { creativeTaskId: string; stageTaskId: string | null; files: readonly ArrivedFile[] },
): Promise<boolean> {
  if (!input.files.length || !input.stageTaskId) return false;
  const stage = await readStage(admin, input.stageTaskId);
  if (!stage) return false;
  const { data: links, error } = await admin.from("task_links").select("parent_id,status_override")
    .eq("child_id", stage.id).eq("relation_kind", "workflow_step");
  if (error) throw error;
  const rows = (links ?? []) as { parent_id: string; status_override: Status | null }[];
  const link = rows.find((row) => row.parent_id === input.creativeTaskId);
  if (!link) return false;
  const effective = link.status_override ?? stage.status;
  if (!OPEN.has(effective)) return false;

  // Mesma decisão da rota delivery-status: etapa compartilhada ou já com
  // andamento próprio muda SÓ nesta Entrega.
  const perDelivery = rows.length > 1 || link.status_override !== null;
  if (perDelivery) {
    const { error: rpcError } = await sessionDb.rpc("set_delivery_stage_status", {
      p_delivery_id: input.creativeTaskId, p_child_id: stage.id, p_expected_status: effective, p_status: "revisao",
    });
    // Outra pessoa mudou o andamento no meio: não sobrescreve, não comenta.
    if (rpcError) return false;
  } else if (!await transitionTaskStatus(admin, stage.id, { to: "revisao", from: [effective] })) {
    return false;
  }

  const label = stepLabelOf(stage);
  const target = perDelivery ? input.creativeTaskId : stage.id;
  await recordStatusComment(admin, {
    targetId: target,
    authorId: await resolveStepResponsible(admin, stage),
    text: `Arquivo novo na Home: ${names(input.files)} — ${statusChangeText(label, effective, "revisao", perDelivery)} (automático).`,
    commentId: stableCommentId("home-arrival", target, ...input.files.map((file) => file.id).sort()),
  });
  return true;
}

/** Mesma regra quando o arquivo chega pela promoção no modal de arquivos: a
 *  Edição é a etapa gravada na pasta do criativo. */
export async function applyEditHomeArrivalForCreative(
  admin: AdminClient,
  sessionDb: SessionDb,
  creativeTaskId: string,
  files: readonly ArrivedFile[],
): Promise<boolean> {
  const { data, error } = await admin.from("drive_creative_workspaces").select("stage_task_id")
    .eq("creative_task_id", creativeTaskId).maybeSingle();
  if (error) throw error;
  const stageTaskId = (data as { stage_task_id?: string | null } | null)?.stage_task_id ?? null;
  return applyEditHomeArrival(admin, sessionDb, { creativeTaskId, stageTaskId, files });
}

type CaptureWorkspace = {
  id: string;
  status: string;
  capture_task_id: string;
  script_folder_id: string | null;
  capture_folder_id: string | null;
  script_seen_file_ids: string[] | null;
  capture_seen_file_ids: string[] | null;
};

/** A etapa Roteiro dos criativos desta diária (compartilhada entre eles). */
async function roteiroOfCapture(admin: AdminClient, captureWorkspaceId: string): Promise<string | null> {
  const { data: creatives, error } = await admin.from("drive_creative_workspaces").select("creative_task_id")
    .eq("capture_workspace_id", captureWorkspaceId);
  if (error) throw error;
  const creativeIds = ((creatives ?? []) as { creative_task_id: string }[]).map((row) => row.creative_task_id);
  if (!creativeIds.length) return null;
  const { data: links, error: linkError } = await admin.from("task_links").select("child_id")
    .in("parent_id", creativeIds).eq("relation_kind", "workflow_step");
  if (linkError) throw linkError;
  const childIds = [...new Set(((links ?? []) as { child_id: string }[]).map((row) => row.child_id))];
  if (!childIds.length) return null;
  const { data: steps, error: stepError } = await admin.from("tasks").select("id").in("id", childIds).eq("subtype", "roteiro").limit(1);
  if (stepError) throw stepError;
  return (steps?.[0] as { id?: string } | undefined)?.id ?? null;
}

/**
 * Roteiro e Captação: arquivo novo na pasta da diária. A primeira leitura de
 * cada pasta (coluna ainda nula) só grava a linha de base, sem mudar status —
 * senão o deploy empurraria para Revisão toda diária que já tem arquivo.
 */
export async function applyCaptureHomeArrivals(admin: AdminClient, captureWorkspaceId: string): Promise<void> {
  if (!isGoogleDriveConfigured()) return;
  const { data, error } = await admin.from("drive_capture_workspaces")
    .select("id,status,capture_task_id,script_folder_id,capture_folder_id,script_seen_file_ids,capture_seen_file_ids")
    .eq("id", captureWorkspaceId).maybeSingle();
  if (error) throw error;
  const workspace = data as CaptureWorkspace | null;
  if (!workspace || workspace.status !== "ready") return;

  const pastas = [
    { folderId: workspace.script_folder_id, column: "script_seen_file_ids" as const, stepId: await roteiroOfCapture(admin, workspace.id) },
    { folderId: workspace.capture_folder_id, column: "capture_seen_file_ids" as const, stepId: workspace.capture_task_id },
  ];
  for (const pasta of pastas) {
    if (!pasta.folderId || !pasta.stepId) continue;
    const files = await directFiles(pasta.folderId);
    const seen = workspace[pasta.column];
    // Registra ANTES de mudar o status: uma falha no meio não pode fazer o
    // mesmo arquivo disparar de novo na próxima leitura.
    const { error: seenError } = await admin.from("drive_capture_workspaces")
      .update({ [pasta.column]: files.map((file) => file.id) }).eq("id", workspace.id);
    if (seenError) throw seenError;
    if (seen === null) continue;
    const fresh = files.filter((file) => !seen.includes(file.id));
    if (!fresh.length) continue;

    const stage = await readStage(admin, pasta.stepId);
    if (!stage || !OPEN.has(stage.status)) continue;
    // Compare-and-set: outra leitura simultânea que já moveu não duplica.
    if (!await transitionTaskStatus(admin, stage.id, { to: "revisao", from: [stage.status] })) continue;
    const label = stepLabelOf(stage);
    await recordStatusComment(admin, {
      targetId: stage.id,
      authorId: await resolveStepResponsible(admin, stage),
      text: `Arquivo novo na pasta ${label}: ${names(fresh)} — ${statusChangeText(label, stage.status, "revisao", false)} (automático).`,
      commentId: stableCommentId("home-arrival", stage.id, ...fresh.map((file) => file.id).sort()),
    });
  }
}
