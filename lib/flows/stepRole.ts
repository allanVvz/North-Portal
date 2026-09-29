// O papel que UMA pessoa ocupa em UMA etapa já resolvida — usado tanto para
// decidir onde um comentário do pai deve cair (lib/flows/commentTarget.ts)
// quanto para rotular quem escreveu um comentário já gravado (TaskModal).
//
// Puro de propósito: nunca faz query. `assigneeIds` chega pronto — no motor
// de roteamento (commentTarget.ts) vem de uma busca em lote em
// `task_assignees`; no selo de comentário (TaskModal) vem do
// `assignee_profile_ids` que a etapa já carrega em memória. Isso evita ter
// dois jeitos de "achar quem é responsável de uma etapa" — um só resolve,
// este só lê o resultado.
//
// Identidade sempre por vínculo estruturado (id de perfil) — nunca pelo texto
// livre do campo `assignee`. Quem não tem conta vinculada nunca aparece em
// `assigneeIds` e portanto nunca ganha papel aqui.

import type { TaskRecord } from "@/lib/validation";
import { responsibilityForSubtype } from "./responsibilityForSubtype";
import type { ResponsibilityKey } from "@/lib/validation";

export type StepRoleResult =
  | { kind: "revisor" }
  | { kind: "responsavel"; responsibility: ResponsibilityKey | null };

export function reviewerIdsOf(step: { reviewer_id: string | null; payload?: Record<string, unknown> }): string[] {
  const configured = step.payload?.reviewer_ids;
  const ids = Array.isArray(configured) ? configured.filter((id): id is string => typeof id === "string") : [];
  return [...new Set([...ids, ...(step.reviewer_id ? [step.reviewer_id] : [])])];
}

/**
 * Quem move um card para Revisão à mão vira revisor dele (30/09): os botões
 * Aprovar / Solicitar revisão aparecem para essa pessoa. Devolve a nova lista
 * de `payload.reviewer_ids`, ou null quando nada muda (já é revisora). O
 * `reviewer_id` principal não é tocado — mexer nele recalcularia a
 * auto-revisão (lib/flows/reviewSkip.ts).
 */
export function reviewerIdsAfterManualReview(step: { reviewer_id: string | null; payload?: Record<string, unknown> }, userId: string | null | undefined): string[] | null {
  if (!userId || reviewerIdsOf(step).includes(userId)) return null;
  const configured = Array.isArray(step.payload?.reviewer_ids) ? step.payload.reviewer_ids.filter((id): id is string => typeof id === "string") : [];
  return [...configured, userId];
}

export function stepRoleOf(
  step: Pick<TaskRecord, "reviewer_id" | "subtype"> & { payload?: TaskRecord["payload"] },
  assigneeIds: ReadonlySet<string>,
  profileId: string | null,
): StepRoleResult | null {
  if (!profileId) return null;
  if (reviewerIdsOf(step).includes(profileId)) return { kind: "revisor" };
  if (assigneeIds.has(profileId)) return { kind: "responsavel", responsibility: responsibilityForSubtype(step.subtype) };
  return null;
}
