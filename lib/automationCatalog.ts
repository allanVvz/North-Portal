// In-code catalog for the two card-driven automations (same spirit as
// lib/taskCatalog.ts): the DB (automation_configs) only stores the instance
// (which config, which client scope, which template card) — label, blurb and
// eligibility rule live here so adding a third automation later is a code
// change, not a migration.

export type AutomationKey = "relatorio_trafego_semanal" | "provisionar_card_metricas";
export const AUTOMATION_KEYS: AutomationKey[] = ["relatorio_trafego_semanal", "provisionar_card_metricas"];

// "ads_account": eligible if the client has a mapped Windsor or Meta ad
// account (windsor.accountMap[slug] || meta.accountMap[slug]).
// "task_metrics": eligible if the client has at least one task_metrics row.
export type AutomationEligibility = "ads_account" | "task_metrics";

export type AutomationDef = {
  label: string;
  description: string;
  eligibility: AutomationEligibility;
  requiresPerformanceTemplate: boolean;
  // Whether the automation needs a template card (task/rotina/plano) picked
  // via the busca/criação UI before it can be registered.
  requiresTemplateTask: boolean;
};

export const AUTOMATION_DEFINITIONS: Record<AutomationKey, AutomationDef> = {
  relatorio_trafego_semanal: {
    label: "Relatório de anúncios",
    description: "Lê o dashboard de Performance e exporta um PDF semanal por cliente.",
    eligibility: "ads_account",
    requiresPerformanceTemplate: true,
    requiresTemplateTask: false,
  },
  provisionar_card_metricas: {
    label: "Provisionar card por cliente",
    description: "Clona o card escolhido (task, rotina ou plano) para cada cliente com dados de métricas.",
    eligibility: "task_metrics",
    requiresPerformanceTemplate: false,
    requiresTemplateTask: true,
  },
};

export function isAutomationKey(x: string): x is AutomationKey {
  return (AUTOMATION_KEYS as string[]).includes(x);
}

export const RECURRENCE_CADENCE_LABEL: Record<string, string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
};
