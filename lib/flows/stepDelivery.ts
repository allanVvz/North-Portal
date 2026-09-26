// Comentário de ENTREGA quando Roteiro ou Captação é concluído (25/09).
//
// Regra do usuário: ao concluir, o responsável da etapa (Roteiro = Luiza,
// Captação = Alisson) "entrega" o que produziu num comentário da etapa, no
// momento da conclusão — uma frase que conta aquele ponto da história do
// criativo e os links logo abaixo. Os links viram cartões no thread: arquivo
// com miniatura, pasta com a grade, Doc com o cartão do Google Docs
// (app/CommentText.tsx → GoogleDrivePreview). O comentário vive na etapa, e o
// thread de cada criativo que a compartilha já o mostra.
//
// De onde vêm os links, em ordem:
//   - Roteiro:  arquivos da pasta Roteiro da diária; pasta vazia → a pasta;
//   - Captação: a pasta Captação da diária, com a contagem de brutos;
//   - sem diária: o último link do Drive/Docs já comentado na própria etapa.
// Sem nenhum link não há o que entregar, e não se comenta (decisão do usuário:
// marco sem arquivo não entra).
//
// Esse comentário não substitui o de status ("Roteiro: Revisão → Concluído",
// no nome de quem mudou). Os dois contam coisas diferentes: quem aprovou, e o
// que foi entregue.

import type { AdminClient } from "@/lib/automations/taskAccess";
import { directFiles } from "@/lib/creativeDriveSync";
import { isCreativeDeliveryKind } from "@/lib/canonicalDeliveryFormats";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import { commentsOf, splitCommentText } from "@/lib/comments";
import { recordStatusComment, resolveStepResponsible, stableCommentId } from "./statusComments";

type Step = { id: string; subtype: string | null; title: string | null; assignee: string | null; completed_at: string | null; payload: Record<string, unknown> | null };
type Capture = { capture_date: string | null; script_folder_id: string | null; capture_folder_id: string | null };

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const ddmm = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : null);

/** Quantos criativos esta etapa atende (ela é compartilhada pela diária). */
async function creativeIdsOf(admin: AdminClient, stepId: string): Promise<string[]> {
  const { data, error } = await admin.from("task_links").select("parent_id").eq("child_id", stepId).eq("relation_kind", "workflow_step");
  if (error) throw error;
  const parentIds = ((data ?? []) as { parent_id: string }[]).map((row) => row.parent_id);
  if (!parentIds.length) return [];
  const { data: parents, error: parentError } = await admin.from("tasks").select("id,kind").in("id", parentIds);
  if (parentError) throw parentError;
  return ((parents ?? []) as { id: string; kind: string | null }[])
    .filter((row) => row.kind !== null && isCreativeDeliveryKind(row.kind))
    .map((row) => row.id);
}

async function captureOf(admin: AdminClient, step: Step, creativeIds: readonly string[]): Promise<Capture | null> {
  const columns = "capture_date,script_folder_id,capture_folder_id";
  if (step.subtype === "captacao") {
    const { data, error } = await admin.from("drive_capture_workspaces").select(columns).eq("capture_task_id", step.id).maybeSingle();
    if (error) throw error;
    return (data as Capture | null) ?? null;
  }
  if (!creativeIds.length) return null;
  const { data: creatives, error } = await admin.from("drive_creative_workspaces").select("capture_workspace_id").in("creative_task_id", [...creativeIds]).limit(1);
  if (error) throw error;
  const captureId = (creatives?.[0] as { capture_workspace_id?: string } | undefined)?.capture_workspace_id;
  if (!captureId) return null;
  const { data, error: captureError } = await admin.from("drive_capture_workspaces").select(columns).eq("id", captureId).maybeSingle();
  if (captureError) throw captureError;
  return (data as Capture | null) ?? null;
}

/** O último link do Drive/Docs que alguém já deixou na etapa. */
function lastDriveLinkIn(step: Step): string | null {
  for (const comment of [...commentsOf(step.payload)].reverse()) {
    const link = splitCommentText(comment.text).reverse().find((part) => "url" in part && parseGoogleDriveUrl(part.url));
    if (link && "url" in link) return link.url;
  }
  return null;
}

async function safeFiles(folderId: string) {
  if (!isGoogleDriveConfigured()) return null;
  try { return await directFiles(folderId); } catch { return null; }
}

/** Monta o texto da entrega; null quando não há link nenhum para entregar. */
export async function stepDeliveryText(admin: AdminClient, step: Step): Promise<string | null> {
  if (step.subtype !== "roteiro" && step.subtype !== "captacao") return null;
  const creativeIds = await creativeIdsOf(admin, step.id);
  const capture = await captureOf(admin, step, creativeIds);
  const dia = ddmm(capture?.capture_date ?? null);

  if (step.subtype === "roteiro") {
    const links: string[] = [];
    const canonicalDoc = typeof step.payload?.daily_script_doc_url === "string"
      && parseGoogleDriveUrl(step.payload.daily_script_doc_url)?.kind === "document"
      ? step.payload.daily_script_doc_url : null;
    if (canonicalDoc) {
      links.push(`[Roteiro da diária](${canonicalDoc})`);
    } else if (capture?.script_folder_id) {
      const files = await safeFiles(capture.script_folder_id);
      if (files?.length) links.push(...files.map((file) => `[${file.name}](${file.webViewLink || fileUrl(file.id)})`));
      else links.push(`[Roteiros${dia ? ` · diária ${dia}` : ""}](${folderUrl(capture.script_folder_id)})`);
    } else {
      const fallback = lastDriveLinkIn(step);
      if (fallback) links.push(`[Roteiro](${fallback})`);
    }
    if (!links.length) return null;
    const n = creativeIds.length;
    const prontos = n > 0 ? `${n} ${n === 1 ? "criativo pronto" : "criativos prontos"} para gravar` : "pronto para gravar";
    return `📝 Roteiro aprovado — ${prontos}.\n${links.join("\n")}`;
  }

  // Captação
  let link: string | null = null;
  let brutos = "os brutos";
  if (capture?.capture_folder_id) {
    link = `[Captação${dia ? ` · diária ${dia}` : ""}](${folderUrl(capture.capture_folder_id)})`;
    const files = await safeFiles(capture.capture_folder_id);
    if (files?.length) brutos = `os ${files.length} ${files.length === 1 ? "bruto" : "brutos"}`;
  } else {
    const fallback = lastDriveLinkIn(step);
    if (fallback) link = `[Captação](${fallback})`;
  }
  if (!link) return null;
  return `🎬 Gravação concluída — ${brutos} da diária estão na pasta. Próximo passo: Edição.\n${link}`;
}

/**
 * Grava a entrega da etapa recém-concluída, no nome do responsável dela (North
 * Ai se não houver). Idempotente por etapa e dia de conclusão: reaprovar no
 * mesmo dia não duplica; reabrir e concluir outro dia é uma entrega nova. Nunca
 * lança — a conclusão já foi salva.
 */
export async function recordStepDelivery(admin: AdminClient, stepId: string): Promise<void> {
  try {
    const { data, error } = await admin.from("tasks").select("id,subtype,title,assignee,completed_at,payload").eq("id", stepId).maybeSingle();
    if (error) throw error;
    const step = data as Step | null;
    if (!step || (step.subtype !== "roteiro" && step.subtype !== "captacao")) return;
    const text = await stepDeliveryText(admin, step);
    if (!text) return;
    const day = (step.completed_at ?? new Date().toISOString()).slice(0, 10);
    await recordStatusComment(admin, {
      targetId: step.id,
      authorId: await resolveStepResponsible(admin, step),
      text,
      commentId: stableCommentId("step-delivery", step.id, day),
    });
  } catch (error) {
    console.warn("[stepDelivery] falha ao registrar a entrega da etapa:", error instanceof Error ? error.message : error);
  }
}
