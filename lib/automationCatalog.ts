// In-code catalog for the two card-driven automations (same spirit as
// lib/taskCatalog.ts): the DB (automation_configs) only stores the instance
// (which config, which client scope, which template card) — label, blurb and
// eligibility rule live here so adding a third automation later is a code
// change, not a migration.

export type AutomationKey =
  | "relatorio_trafego_semanal"
  | "provisionar_card_metricas"
  | "coleta_metrica_cliente"
  | "relatorio_conversao"
  | "diaria_recorrente";
export const AUTOMATION_KEYS: AutomationKey[] = [
  "relatorio_trafego_semanal",
  "provisionar_card_metricas",
  "coleta_metrica_cliente",
  "relatorio_conversao",
  "diaria_recorrente",
];

// "ads_account": eligible if the client has a mapped Windsor or Meta ad
// account (windsor.accountMap[slug] || meta.accountMap[slug]).
// "task_metrics": eligible if the client has at least one task_metrics row.
// "any_client": no precondition — the card just has to belong to a client.
export type AutomationEligibility = "ads_account" | "task_metrics" | "any_client";

export type AutomationDef = {
  label: string;
  description: string;
  eligibility: AutomationEligibility;
  requiresPerformanceTemplate: boolean;
  // Whether the automation needs a template card (task/rotina/plano) picked
  // via the busca/criação UI before it can be registered.
  requiresTemplateTask: boolean;
  // Whether the admin must pick which metric keys the card asks the client for
  // (automation_configs.collect_metric_keys).
  requiresMetricKeys?: boolean;
  /** De onde vêm os dados. Mostrado na tela para que as duas pipelines de
   *  relatório não pareçam configurações irmãs. */
  source: string;
  /** Automação da qual esta depende para o mesmo cliente. Resolvida e gravada como
   *  `automation_configs.depends_on_config_id` ao salvar — a cascata é um
   *  atributo, não uma dedução por co-locação. */
  dependsOn?: AutomationKey;
};

export const AUTOMATION_DEFINITIONS: Record<AutomationKey, AutomationDef> = {
  diaria_recorrente: {
    label: "Diária recorrente",
    description: "Cria um Plano por gravação, com Roteiro e Captação compartilhados e uma Entrega por peça.",
    eligibility: "any_client",
    requiresPerformanceTemplate: false,
    requiresTemplateTask: true,
    source: "Calendário do Plano recorrente",
  },
  relatorio_trafego_semanal: {
    label: "Relatório de anúncios",
    description: "Lê o dashboard de Performance e exporta um PDF semanal por cliente.",
    eligibility: "ads_account",
    requiresPerformanceTemplate: true,
    requiresTemplateTask: false,
    source: "API de mídia (Meta / Windsor)",
  },
  provisionar_card_metricas: {
    label: "Provisionar card por cliente",
    description: "Clona o card escolhido (task, rotina ou plano) para cada cliente com dados de métricas.",
    eligibility: "task_metrics",
    requiresPerformanceTemplate: false,
    requiresTemplateTask: true,
    source: "Clientes com métricas registradas",
  },
  // Conversões (agendamento, orçamento fechado, venda no balcão) quase nunca
  // chegam pela API de anúncios: dependem do Pixel/CAPI do cliente e muitas
  // sequer acontecem online. Então a plataforma pergunta — o card vence, vira
  // pendência no portal, e o número que o cliente digita cai em task_metrics.
  coleta_metrica_cliente: {
    label: "Coleta de métricas com o cliente",
    description: "No vencimento do card, pede os números ao cliente pelo portal e grava a resposta nas métricas.",
    eligibility: "any_client",
    requiresPerformanceTemplate: false,
    requiresTemplateTask: true,
    requiresMetricKeys: true,
    source: "Resposta do cliente no portal",
  },
  // Segunda pipeline da cascata: só roda sobre a revisão FINAL do relatório de
  // anúncios da mesma ocorrência (traffic_reports), lê o feedback da semana num
  // comentário e gera o relatório de vendas. Ver docs/reporting/report-pipeline.md.
  relatorio_conversao: {
    label: "Relatório de conversão",
    description: "Depois que o relatório de anúncios é finalizado, lê o feedback da semana no comentário e gera o relatório de conversão.",
    eligibility: "ads_account",
    requiresPerformanceTemplate: true,
    requiresTemplateTask: true,
    source: "Comentário do Feedback da semana",
    dependsOn: "relatorio_trafego_semanal",
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
