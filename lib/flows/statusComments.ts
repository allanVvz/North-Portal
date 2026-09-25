// Comentários que registram mudança de status em criativos (25/09).
//
// Regra do usuário, em três partes:
//   1. mudança MANUAL de status de criativo → comentário no nome de QUEM mudou;
//   2. mudança AUTOMÁTICA (arquivo novo na Home da etapa → Revisão) →
//      comentário no nome do RESPONSÁVEL da etapa;
//   3. sem responsável conhecido, qualquer automação escreve como North Ai.
//
// "Criativo" tem fronteira explícita (`isCreativeStatusScope`): etapas de
// Entregas de automação (relatórios) ficam de fora de propósito. Um comentário
// com autor humano num card de relatório é lido como PEDIDO DE REVISÃO pela
// cascata (`humanComments` em lib/automations/conversionFlow.ts) — registrar
// "Relatório: Revisão → Concluído" ali regeraria o relatório.
//
// Os comentários humanos vão direto pela RPC `append_task_comment_idempotent`,
// não pela rota de comentários: a rota dispara `scheduleCommentAutomation` e
// notifica, e aqui nenhum dos dois cabe — a mudança de status já notifica.

import { createHash, randomUUID } from "node:crypto";
import { STATUS_LABEL } from "@/lib/notifiableChange";
import { SUBTYPE_LABEL } from "@/lib/taskCatalog";
import type { AdminClient } from "@/lib/automations/taskAccess";
import { updateTaskPayload } from "@/lib/automations/taskWrites";

type TaskLike = { id: string; kind?: string | null; subtype?: string | null; workflow_version_id?: string | null };

/** Etapa de uma Entrega criativa, ou criativo avulso (sem fluxo). */
export async function isCreativeStatusScope(admin: AdminClient, task: TaskLike): Promise<boolean> {
  if (task.kind === "criativo" && !task.workflow_version_id) return true;
  const { data: links, error } = await admin.from("task_links").select("parent_id")
    .eq("child_id", task.id).eq("relation_kind", "workflow_step");
  if (error) throw error;
  const parentIds = ((links ?? []) as { parent_id: string }[]).map((link) => link.parent_id);
  if (!parentIds.length) return false;
  const { data: parents, error: parentError } = await admin.from("tasks").select("kind").in("id", parentIds);
  if (parentError) throw parentError;
  return ((parents ?? []) as { kind: string | null }[]).some((parent) => parent.kind === "criativo");
}

export function stepLabelOf(task: { subtype?: string | null; title?: string | null }): string {
  return (task.subtype && SUBTYPE_LABEL[task.subtype]) || task.title || "Card";
}

const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

/** "Edição: Revisão → Em produção", com o recorte quando a mudança vale só
 *  para uma das Entregas que compartilham a etapa. */
export function statusChangeText(stepLabel: string, from: string, to: string, perDelivery: boolean): string {
  return `${stepLabel}: ${statusLabel(from)} → ${statusLabel(to)}${perDelivery ? " (só nesta entrega)" : ""}`;
}

/** Id de comentário curto e estável (a RPC humana aceita 8–64 caracteres). */
export function stableCommentId(prefix: string, ...parts: ReadonlyArray<string>): string {
  const digest = createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

/** Id único por evento: uma mudança de status acontece uma vez; o retry da
 *  mesma requisição reusa o id que ela gerou. */
export function eventCommentId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

/**
 * Grava o comentário no nome de `authorId`, ou como North Ai quando não há
 * autor conhecido. Nunca lança: o status já foi salvo, e um comentário que
 * falha não pode desfazer a ação de quem mudou.
 */
export async function recordStatusComment(
  admin: AdminClient,
  input: { targetId: string; authorId: string | null; text: string; commentId: string },
): Promise<void> {
  try {
    if (input.authorId) {
      const { error } = await admin.rpc("append_task_comment_idempotent", {
        p_task_id: input.targetId, p_author_id: input.authorId, p_text: input.text, p_comment_id: input.commentId,
      });
      if (!error) return;
      // Perfil inexistente ou RPC ausente: cai no North Ai em vez de perder o registro.
    }
    await updateTaskPayload(admin, input.targetId, { text: input.text, commentId: input.commentId });
  } catch (error) {
    console.warn("[statusComments] falha ao registrar comentário de status:", error instanceof Error ? error.message : error);
  }
}

/**
 * O responsável da etapa como PERFIL (o comentário precisa de `author_id` para
 * sair com nome e foto). Ordem: o primeiro perfil vinculado; senão o primeiro
 * nome do texto livre `assignee` ("Luiza, Allan" → Luiza) casado com o nome do
 * perfil; senão null — e quem chama escreve como North Ai.
 */
export async function resolveStepResponsible(admin: AdminClient, step: { id: string; assignee?: string | null }): Promise<string | null> {
  const { data: linked, error } = await admin.from("task_assignees").select("profile_id").eq("task_id", step.id).limit(1);
  if (error) throw error;
  const profileId = (linked?.[0] as { profile_id?: string } | undefined)?.profile_id;
  if (profileId) return profileId;
  const firstName = (step.assignee ?? "").split(",")[0]?.trim();
  if (!firstName || firstName === "North Ai") return null;
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id").ilike("full_name", firstName).limit(2);
  if (profileError) throw profileError;
  // Dois perfis com o mesmo nome: não dá para saber de quem é — North Ai.
  return profiles?.length === 1 ? (profiles[0] as { id: string }).id : null;
}
