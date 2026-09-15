// O que o feedback da semana DE FATO trouxe — puro, sem banco nem PDF.
//
// Duas perguntas que o relatório de vendas e o registro em `conversion_reports`
// fazem sobre o mesmo comentário, e que por isso moram num lugar só:
//
// 1. Qual é o MODO do relatório? Derivado do que foi informado, nunca da
//    configuração. Os chips da automação (`collect_metric_keys`) dizem o que
//    TENTAR ler; o modo é o que voltou. É o que deixa um motor só atender o
//    cliente que responde quatro métricas e o que só conta seguidores.
//
// 2. Quanto das vendas tem ORIGEM identificada? "5 vendas, nenhuma com origem"
//    e "nenhuma venda" são leituras opostas, e sem a cobertura explícita as
//    duas aparecem igual — como tabela vazia.

import type { ConversionRow } from "@/lib/ai/extractMetrics";

export type ConversionMode = "followers_only" | "sales_summary" | "sales_segmented" | "no_data";

export type InformedTotals = {
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
};

export type SourceTotals = { vendas: number; receita: number | null };

export type Attribution = {
  /** Vendas relatadas no total; `null` quando vendas não foram informadas. */
  informadas: number | null;
  /** Vendas descritas COM origem (#1/#2/#3), nunca acima das informadas. */
  comOrigem: number;
  /** Cobertura em %, só quando há vendas informadas maiores que zero. */
  coberturaPct: number | null;
  /** Por origem. Receita só quando ao menos uma venda daquela origem trouxe
   *  valor — nunca a receita total distribuída entre fontes. */
  porFonte: Partial<Record<"1" | "2" | "3", SourceTotals>>;
};

export function conversionModeOf(totals: InformedTotals, linhas: readonly ConversionRow[]): ConversionMode {
  const comercial = totals.vendas !== null || totals.agendamentos !== null || totals.receita !== null;
  if (comercial) return linhas.some((l) => l.fonte !== null) ? "sales_segmented" : "sales_summary";
  return totals.seguidores !== null ? "followers_only" : "no_data";
}

/** Uma linha conta como VENDA quando não está marcada como só agendada — o
 *  gestor nem sempre diz o status, e "#1 1200" sem status é uma venda. */
function isVenda(l: ConversionRow): boolean {
  return l.status !== "agendado";
}

export function attributionOf(vendasInformadas: number | null, linhas: readonly ConversionRow[]): Attribution {
  const vendidasComFonte = linhas.filter((l) => isVenda(l) && l.fonte !== null);
  const porFonte: Attribution["porFonte"] = {};
  for (const l of vendidasComFonte) {
    const fonte = l.fonte as "1" | "2" | "3";
    const atual = porFonte[fonte] ?? { vendas: 0, receita: null };
    porFonte[fonte] = {
      vendas: atual.vendas + 1,
      receita: l.valor === null ? atual.receita : (atual.receita ?? 0) + l.valor,
    };
  }
  // Se o gestor disse "5 vendas" e descreveu três com origem, são 3 atribuídas e
  // 2 sem origem — nunca 5 atribuídas. E se descreveu mais linhas do que o total
  // que declarou, o total declarado manda.
  const comOrigem = vendasInformadas === null
    ? vendidasComFonte.length
    : Math.min(vendidasComFonte.length, vendasInformadas);
  const coberturaPct = vendasInformadas !== null && vendasInformadas > 0
    ? Math.round((comOrigem / vendasInformadas) * 100)
    : null;
  return { informadas: vendasInformadas, comOrigem, coberturaPct, porFonte };
}
