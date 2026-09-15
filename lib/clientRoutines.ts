// As rotinas padrão de um cliente novo (ATA 14/09).
//
// "As rotinas padrões (Assinatura de contrato, reunião de kickoff, onboarding,
// acompanhamento semanal, reunião mensal) devem ser etapa final de finalização
// do cadastro de novo cliente; só pode finalizar o cadastro com essas etapas
// preenchidas com DATAS e RESPONSÁVEIS."
//
// Viram cards do cliente no momento do cadastro: as três únicas como tarefa
// comum, as duas periódicas como demanda recorrente (sempre aberta, com a
// próxima data no futuro e os checks registrados no card — ver lib/cycleLog.ts).
// A lista mora em código, e não na tabela de checkpoints comerciais, porque a
// cadência é parte da definição: um acompanhamento "semanal" que alguém cadastrasse
// sem cadência deixaria de ser acompanhamento.

import type { RecurringCadence } from "./validation";

export type ClientRoutineDef = {
  key: string;
  title: string;
  description: string;
  cadence: RecurringCadence | null;
};

export const CLIENT_STANDARD_ROUTINES: readonly ClientRoutineDef[] = [
  {
    key: "assinatura_contrato",
    title: "Assinatura de contrato",
    description: "Contrato assinado pelas duas partes e arquivado na pasta do cliente.",
    cadence: null,
  },
  {
    key: "reuniao_kickoff",
    title: "Reunião de kickoff",
    description: "Apresentar o time, o cronograma mensal e os próximos passos; pedir acessos e o novo WhatsApp.",
    cadence: null,
  },
  {
    key: "onboarding",
    title: "Onboarding",
    description: "Briefing preenchido, acessos concedidos, pastas e materiais do cliente organizados (até 2 dias após a assinatura).",
    cadence: null,
  },
  {
    key: "acompanhamento_semanal",
    title: "Acompanhamento semanal",
    description: "Ligação semanal de CS: chegada dos leads, scripts, publicações, otimizações, atrasos e próximos passos.",
    cadence: "semanal",
  },
  {
    key: "reuniao_mensal",
    title: "Reunião mensal",
    description: "Reunião tática mensal: relatório padrão North, leitura dos dados, otimizações e novas demandas.",
    cadence: "mensal",
  },
];

export type ClientRoutineInput = { key: string; date: string; assigneeId: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** O que falta para o cadastro poder ser finalizado — `null` quando está completo.
 *  A mesma função valida a tela (botão desabilitado) e a API (400). */
export function routineScheduleProblem(inputs: readonly ClientRoutineInput[] | undefined): string | null {
  const byKey = new Map((inputs ?? []).map((input) => [input.key, input]));
  const missing = CLIENT_STANDARD_ROUTINES.filter((routine) => {
    const input = byKey.get(routine.key);
    return !input || !ISO_DATE.test(input.date) || !input.assigneeId;
  });
  if (!missing.length) return null;
  return `Preencha data e responsável das rotinas: ${missing.map((routine) => routine.title).join(", ")}.`;
}
