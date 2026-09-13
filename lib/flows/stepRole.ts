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

export function stepRoleOf(
  step: Pick<TaskRecord, "reviewer_id" | "subtype">,
  assigneeIds: ReadonlySet<string>,
  profileId: string | null,
): StepRoleResult | null {
  if (!profileId) return null;
  if (step.reviewer_id === profileId) return { kind: "revisor" };
  if (assigneeIds.has(profileId)) return { kind: "responsavel", responsibility: responsibilityForSubtype(step.subtype) };
  return null;
}
