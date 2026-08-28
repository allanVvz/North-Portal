// Funil dos leads capturados pelos formulários das landing pages
// (app/(site)/components/LeadForm.tsx -> POST /api/leads -> public.leads).
//
// Módulo puro, sem React e sem Supabase, espelhando app/admin/clientPipeline.ts:
// a tela consome daqui e mais nada precisa saber a forma do funil. É também
// onde o mapa "status do North <-> estágio do CRM" vai morar quando existir uma
// integração — assim a UI não precisa aprender que um CRM entrou.

export type LeadStatus = "novo" | "contatado" | "qualificado" | "convertido" | "descartado";

// Ordem do funil. "descartado" fica por último de propósito: é uma saída, não
// uma etapa — quem lê a tela da esquerda para a direita deve ver o avanço.
export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "novo", "contatado", "qualificado", "convertido", "descartado",
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo",
  contatado: "Contatado",
  qualificado: "Qualificado",
  convertido: "Convertido",
  descartado: "Descartado",
};

const VALID = new Set<LeadStatus>(LEAD_STATUS_ORDER);

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && VALID.has(value as LeadStatus);
}

/** Nunca propaga um status desconhecido (linha antiga do banco, resposta de um
 *  CRM futuro com vocabulário próprio) — cai no começo do funil. */
export function leadStatusOf(raw: unknown): LeadStatus {
  return isLeadStatus(raw) ? raw : "novo";
}

// "convertido" é o único status que a tela não concede sozinha: ele significa
// que existe um cliente criado, e quem cria o cliente é o fluxo de
// /admin/novo (que provisiona login, Drive e checkpoints). Arrastar um card
// para essa coluna sem passar por lá deixaria um lead marcado como convertido
// apontando para cliente nenhum.
export function canSetManually(next: LeadStatus): boolean {
  return next !== "convertido";
}

/** Um lead já convertido está encerrado: reabri-lo pela tela desfaria a ligação
 *  com o cliente sem desfazer o cliente. */
export function canMoveFrom(current: LeadStatus): boolean {
  return current !== "convertido";
}

export function canTransition(current: LeadStatus, next: LeadStatus): boolean {
  if (current === next) return false;
  return canMoveFrom(current) && canSetManually(next);
}

// Faixas de investimento declaradas no formulário, na ordem do menor para o
// maior — o check do banco (migration 20260815000001) aceita exatamente estes.
export const INVESTMENT_ORDER = ["até-3k", "3k-6k", "6k-12k", "12k+"] as const;
export type LeadInvestment = (typeof INVESTMENT_ORDER)[number];

export function investmentRank(raw: string): number {
  const index = (INVESTMENT_ORDER as readonly string[]).indexOf(raw);
  return index === -1 ? -1 : index;
}
