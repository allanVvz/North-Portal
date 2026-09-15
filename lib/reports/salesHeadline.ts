// A primeira linha do relatório de vendas — a frase que o cliente lê antes de
// olhar qualquer número.
//
// Determinística de propósito (sem IA): o relatório é gerado toda semana, sem
// ninguém revisando antes de chegar no cliente. Uma frase gerada por LLM traria
// custo, latência e variação de tom num lugar onde o texto precisa ser sempre o
// mesmo para os mesmos números — e onde um exagero ("semana excepcional") num
// número mediano custa credibilidade.
//
// Duas regras que a frase NUNCA quebra:
//
// 1. `null` é "não informado" e nunca vira 0. Uma semana em que o gestor só
//    falou de seguidores não é uma semana sem vendas — é uma semana sem
//    informação sobre vendas, e a frase diz isso.
// 2. Cada percentual fica COLADO na sua métrica. "R$ 4.100 em receita e 5
//    vendas (+28%)" é ambíguo (a receita subiu 28%, as vendas subiram 25%);
//    a variação vai entre parênteses logo depois do número a que se refere.

import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";

export type SalesHeadlineInput = {
  receita: number | null;
  vendas: number | null;
  agendamentos: number | null;
  /** Ganho de seguidores na semana (total atual − total anterior). */
  seguidoresGanho?: number | null;
  prev: { receita: number | null; vendas: number | null } | null;
};

/** Abaixo disto a semana não "subiu" nem "caiu" — oscilou. */
const TOM_LIMIAR = 0.05;

function pct(atual: number, anterior: number): string {
  const delta = Math.round(((atual - anterior) / anterior) * 100);
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`;
}

/** A variação daquela métrica, entre parênteses, ou nada quando não há base. */
function marca(atual: number | null, anterior: number | null | undefined): string {
  if (atual === null || anterior === null || anterior === undefined || anterior <= 0) return "";
  return ` (${pct(atual, anterior)})`;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function salesHeadline({ receita, vendas, agendamentos, seguidoresGanho = null, prev }: SalesHeadlineInput): string {
  // Nada comercial informado: a frase fala do que existe, sem afirmar zero.
  if (receita === null && vendas === null) {
    if (agendamentos !== null && agendamentos > 0) {
      return `${plural(agendamentos, "agendamento em aberto", "agendamentos em aberto")} — vendas não informadas nesta semana.`;
    }
    if (seguidoresGanho !== null && seguidoresGanho > 0) {
      return `Semana de audiência — ${plural(seguidoresGanho, "seguidor novo", "seguidores novos")}.`;
    }
    return "Sem números comerciais informados nesta semana.";
  }

  // Informado como zero é diferente de não informado: aqui o gestor disse.
  if ((receita ?? 0) <= 0 && (vendas ?? 0) <= 0) {
    return agendamentos !== null && agendamentos > 0
      ? `Semana sem vendas fechadas — ${plural(agendamentos, "agendamento em aberto", "agendamentos em aberto")}.`
      : "Semana sem vendas fechadas.";
  }

  const partes: string[] = [];
  if (receita !== null && receita > 0) {
    partes.push(`${formatAcquisitionValue(receita, "money")} em receita${marca(receita, prev?.receita)}`);
  }
  if (vendas !== null && vendas > 0) {
    partes.push(`${plural(vendas, "venda fechada", "vendas fechadas")}${marca(vendas, prev?.vendas)}`);
  }
  const corpo = partes.join(" e ");

  // O tom segue a grandeza que manda na frase: receita quando existe, senão
  // vendas. Comparar receita e chamar de "alta" uma frase que só mostra vendas
  // confundiria o leitor.
  const atual = receita !== null && receita > 0 ? receita : vendas;
  const anterior = receita !== null && receita > 0 ? prev?.receita ?? null : prev?.vendas ?? null;
  if (atual === null || anterior === null || anterior <= 0) return `${corpo}.`;

  const variacao = (atual - anterior) / anterior;
  if (variacao >= TOM_LIMIAR) return `Semana de alta — ${corpo}.`;
  if (variacao <= -TOM_LIMIAR) return `Semana de queda — ${corpo}.`;
  return `Semana estável — ${corpo}.`;
}
