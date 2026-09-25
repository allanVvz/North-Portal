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
// Todo arquivo novo é comentado (25/09), mesmo sem mudar status: o thread
// conta a história do criativo, e cada arquivo entra como link logo abaixo da
// frase — o thread o mostra como cartão com miniatura. O status só muda se a
// etapa estiver em Entrada ou Em produção.
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

const fileLink = (file: ArrivedFile) => `[${file.name}](https://drive.google.com/file/d/${file.id}/view)`;
const fileLinks = (files: readonly ArrivedFile[]) => files.map(fileLink).join("\n");

/** "🎞️ Arquivo final — Edição: Em produção → Revisão (só nesta entrega) (automático).\n[arquivo](link)" */
export function editArrivalText(files: readonly ArrivedFile[], change: string | null): string {
  const head = files.length === 1 ? "Arquivo final" : `${files.length} arquivos finais`;
  return `🎞️ ${head}${change ? ` — ${change} (automático)` : ""}.\n${fileLinks(files)}`;
}

export function folderArrivalText(label: string, files: readonly ArrivedFile[], change: string | null): string {
  const icon = label === "Roteiro" ? "📝" : "🎬";
  const head = files.length === 1 ? `Arquivo novo na pasta ${label}` : `${files.length} arquivos novos na pasta ${label}`;
  return `${icon} ${head}${change ? ` — ${change} (automático)` : ""}.\n${fileLinks(files)}`;
}

/** Criativos cuja Edição anda junto com a etapa (sem andamento próprio). Uma
 *  mudança da etapa inteira só alcança esses. */
export async function creativesFollowingStage(admin: AdminClient, stageTaskId: string): Promise<string[]> {
  const { data, error } = await admin.from("task_links").select("parent_id,status_override")
    .eq("child_id", stageTaskId).eq("relation_kind", "workflow_step");
  if (error) throw error;
  return ((data ?? []) as { parent_id: string; status_override: string | null }[])
    .filter((link) => link.status_override === null).map((link) => link.parent_id);
}

/** Edição: arquivo novo na Home do criativo. Sempre comenta a chegada; devolve
 *  se a etapa mudou para Revisão. */
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

  // Mesma decisão da rota delivery-status: etapa compartilhada ou já com
  // andamento próprio muda SÓ nesta Entrega.
  const perDelivery = rows.length > 1 || link.status_override !== null;
  let changed = false;
  if (OPEN.has(effective)) {
    if (perDelivery) {
      const { error: rpcError } = await sessionDb.rpc("set_delivery_stage_status", {
        p_delivery_id: input.creativeTaskId, p_child_id: stage.id, p_expected_status: effective, p_status: "revisao",
      });
      // Outra pessoa mudou o andamento no meio: não sobrescreve.
      changed = !rpcError;
    } else {
      changed = Boolean(await transitionTaskStatus(admin, stage.id, { to: "revisao", from: [effective] }));
    }
  }

  // O arquivo é deste criativo: o comentário fica no card dele, salvo quando a
  // etapa inteira (só dele) mudou — aí fica na etapa, que o thread já mostra.
  const target = changed && !perDelivery ? stage.id : input.creativeTaskId;
  await recordStatusComment(admin, {
    targetId: target,
    authorId: await resolveStepResponsible(admin, stage),
    text: editArrivalText(input.files, changed ? statusChangeText(stepLabelOf(stage), effective, "revisao", perDelivery) : null),
    commentId: stableCommentId("home-arrival", target, ...input.files.map((file) => file.id).sort()),
  });
  return changed;
}

/** Áudio posto na Home ou no Preview vai para os brutos (é material da
 *  edição, não entrega) — comentado no card do criativo pelo responsável da
 *  Edição. */
export async function recordAudioToRaw(
  admin: AdminClient,
  input: { creativeTaskId: string; stageTaskId: string | null; files: readonly ArrivedFile[] },
): Promise<void> {
  if (!input.files.length) return;
  const stage = input.stageTaskId ? await readStage(admin, input.stageTaskId) : null;
  const head = input.files.length === 1 ? "Áudio guardado nos brutos" : `${input.files.length} áudios guardados nos brutos`;
  await recordStatusComment(admin, {
    targetId: input.creativeTaskId,
    authorId: stage ? await resolveStepResponsible(admin, stage) : null,
    text: `🎧 ${head} — áudio é material da edição, não final.\n${fileLinks(input.files)}`,
    commentId: stableCommentId("audio-to-raw", input.creativeTaskId, ...input.files.map((file) => file.id).sort()),
  });
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
    if (!stage) continue;
    // Compare-and-set: outra leitura simultânea que já moveu não duplica.
    const changed = OPEN.has(stage.status) && Boolean(await transitionTaskStatus(admin, stage.id, { to: "revisao", from: [stage.status] }));
    const label = stepLabelOf(stage);
    await recordStatusComment(admin, {
      targetId: stage.id,
      authorId: await resolveStepResponsible(admin, stage),
      text: folderArrivalText(label, fresh, changed ? statusChangeText(label, stage.status, "revisao", false) : null),
      commentId: stableCommentId("home-arrival", stage.id, ...fresh.map((file) => file.id).sort()),
    });
  }
}
