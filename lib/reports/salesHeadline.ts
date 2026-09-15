// A primeira linha do relatório de vendas — a frase que o cliente lê antes de
// olhar qualquer número.
//
// Determinística de propósito (sem IA): o relatório é gerado toda semana, sem
// ninguém revisando antes de chegar no cliente. Uma frase gerada por LLM traria
// custo, latência e variação de tom num lugar onde o texto precisa ser sempre o
// mesmo para os mesmos números — e onde um exagero ("semana excepcional") num
// número mediano custa credibilidade.
//
// Qual grandeza manda: RECEITA quando há receita, senão VENDAS, senão
// agendamentos. É a ordem em que o dono do negócio lê o próprio resultado.

import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";

export type SalesHeadlineInput = {
  receita: number;
  vendas: number;
  agendamentos: number;
  prev: { receita: number | null; vendas: number | null } | null;
};

/** Abaixo disto a semana não "subiu" nem "caiu" — oscilou. */
const TOM_LIMIAR = 0.05;

function pct(atual: number, anterior: number): string {
  const delta = Math.round(((atual - anterior) / anterior) * 100);
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function salesHeadline({ receita, vendas, agendamentos, prev }: SalesHeadlineInput): string {
  // Nada vendido nem agendado: dizer isso de frente é melhor do que uma frase
  // de resultado com zeros dentro.
  if (receita <= 0 && vendas <= 0) {
    return agendamentos > 0
      ? `Semana sem vendas fechadas — ${plural(agendamentos, "agendamento em aberto", "agendamentos em aberto")}.`
      : "Semana sem vendas ou agendamentos registrados.";
  }

  const corpo = receita > 0
    ? `${formatAcquisitionValue(receita, "money")} em receita${vendas > 0 ? ` e ${plural(vendas, "venda fechada", "vendas fechadas")}` : ""}`
    : plural(vendas, "venda fechada", "vendas fechadas");

  // Base de comparação: a mesma grandeza que manda no corpo da frase. Comparar
  // receita com receita e venda com venda evita a frase dizer "alta" olhando um
  // número que nem aparece nela.
  const atual = receita > 0 ? receita : vendas;
  const anterior = receita > 0 ? prev?.receita ?? null : prev?.vendas ?? null;

  if (anterior === null || anterior <= 0) {
    return `Primeira semana com dados — ${corpo}.`;
  }

  const variacao = (atual - anterior) / anterior;
  const marca = ` (${pct(atual, anterior)} vs. a semana anterior)`;
  if (variacao >= TOM_LIMIAR) return `Semana de alta — ${corpo}${marca}.`;
  if (variacao <= -TOM_LIMIAR) return `Semana de queda — ${corpo}${marca}.`;
  return `Semana estável — ${corpo}${marca}.`;
}
