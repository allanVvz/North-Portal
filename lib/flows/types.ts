// Tipos do molde de fluxo, sem nenhum import — módulo folha de propósito.
// template.ts fala com o banco (e portanto arrasta o client de serviço junto),
// então o modal e o quadro, que são componentes de cliente, importam daqui.

export type FlowStepDef = {
  id: string;
  step_key: string;
  order_index: number;
  title: string;
  kind: string;
  subtype: string | null;
  lead_days: number;
  progress_weight: number;
  default_assignee: string | null;
  client_visible: boolean;
};

export type FlowTemplate = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  steps: FlowStepDef[];
};
