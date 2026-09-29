// Links para a Operação já filtrada — a Home e o Pulso mandam a pessoa direto
// para o recorte que resolve o que ela está vendo (29/09).
//
//   /admin/operacao?area=tarefas-rotinas&responsavel=Allan&situacao=atrasada&agrupar=prazo
//
// Os valores são os mesmos dos filtros da barra (OperationFilter). Status e Tipo
// aceitam vários, separados por vírgula.

import type { OperationFilterAttr } from "./operationItems";

export type OperacaoLink = {
  area?: "tarefas-rotinas" | "planos-entregas";
  status?: string[];
  situacao?: string;
  tipo?: string[];
  cliente?: string;
  responsavel?: string;
  prioridade?: string;
  agrupar?: "responsavel" | "cliente" | "prazo" | "kanban";
  visao?: "quadro" | "lista" | "calendario";
};

/** Parâmetros de URL que viram filtro da barra. */
export const URL_FILTER_ATTRS: OperationFilterAttr[] = ["status", "situacao", "tipo", "cliente", "responsavel", "prioridade"];

export function operacaoHref(link: OperacaoLink): string {
  const params = new URLSearchParams();
  params.set("area", link.area ?? "tarefas-rotinas");
  if (link.status?.length) params.set("status", link.status.join(","));
  if (link.situacao) params.set("situacao", link.situacao);
  if (link.tipo?.length) params.set("tipo", link.tipo.join(","));
  if (link.cliente) params.set("cliente", link.cliente);
  if (link.responsavel) params.set("responsavel", link.responsavel);
  if (link.prioridade) params.set("prioridade", link.prioridade);
  if (link.agrupar) params.set("agrupar", link.agrupar);
  if (link.visao) params.set("visao", link.visao);
  return `/admin/operacao?${params.toString()}`;
}
