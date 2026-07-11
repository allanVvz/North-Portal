// Pipeline stage for a client — used by the Clientes screen's Pipeline view.
// Criação: nothing started yet. Onboarding: briefing sent and/or checkpoints
// underway but not finished. Em Operação: onboarding checkpoints complete.
export type ClientStage = "criacao" | "onboarding" | "operacao";

export const STAGE_ORDER: ClientStage[] = ["criacao", "onboarding", "operacao"];
export const STAGE_LABEL: Record<ClientStage, string> = {
  criacao: "Criação",
  onboarding: "Onboarding",
  operacao: "Em Operação",
};

export function clientStageFor(briefingSubmitted: boolean, checkpointsPct: number): ClientStage {
  if (checkpointsPct >= 100) return "operacao";
  if (briefingSubmitted || checkpointsPct > 0) return "onboarding";
  return "criacao";
}
