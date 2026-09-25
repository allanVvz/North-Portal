"use client";

import TaskKindIcon from "./TaskKindIcon";
import type { TaskRecord } from "@/lib/validation";

export type ParentRelation = "entrega" | "plano" | "recorrencia" | "referencia";

export type ParentBoxItem = {
  parent: TaskRecord;
  /** Que TIPO de relação isto é — não o kind do `parent`. Decide a cor do
   * marcador (RELATION_DOT), não o ícone (que continua sendo o do `parent`). */
  relation: ParentRelation;
  /** Ex.: "Etapa 2 de 4 · Captação", "Atividade do plano", "Execução da recorrência". */
  subtitle: string;
  /** Progresso do card pai, 0–100. Referências não exibem percentual porque
   * não participam do rollup da família atual. */
  progress?: number;
};

// Um marcador fixo por TIPO DE RELAÇÃO (não pelo kind do card de destino) —
// sem isto, duas linhas "Faz parte de" só se distinguiam pelo texto do
// subtítulo, e uma relação de Plano e uma de Recorrência-para-um-Plano
// podiam sair na MESMA cor (a do ícone do destino, que é `plano_acao` nos
// dois casos). O ponto colorido aqui identifica a RELAÇÃO em si, de relance.
const RELATION_DOT: Record<ParentRelation, string> = {
  entrega: "tm-parentbox-dot-entrega",
  plano: "tm-parentbox-dot-plano",
  recorrencia: "tm-parentbox-dot-recorrencia",
  referencia: "tm-parentbox-dot-referencia",
};

// A caixa "Faz parte de" (ou "Relacionado a") do modal de um card FILHO —
// UMA caixa por tipo de rótulo, várias LINHAS dentro dela, uma por card
// relacionado. Antes cada relação (entrega, cada Plano, recorrência,
// referência) virava uma caixa inteira própria — um card que pertencia a 6
// Planos ao mesmo tempo (a agregação da ADM North) desenhava 6 caixas
// idênticas, cada uma repetindo "Faz parte de" e o padding em volta. O rótulo
// e a moldura existem uma vez só; a lista é que cresce.
//
// Enxuta e só de navegação: cada linha é o card relacionado (clicável, com o
// progresso quando houver rollup) e um subtítulo dizendo qual é a relação.
export default function CardParentBox({
  label,
  items,
  canOpen,
  onOpen,
}: {
  label: string;
  items: ParentBoxItem[];
  canOpen: boolean;
  onOpen: (parent: TaskRecord) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="tm-box tm-parentbox">
      <p className="tm-box-label">{label}</p>
      <div className="tm-member-list">
        {items.map((item) => (
          <div className="tm-member" key={`${item.relation}-${item.parent.id}`}>
            <button type="button" className="tm-member-open" onClick={() => onOpen(item.parent)} disabled={!canOpen}>
              <TaskKindIcon kind={item.parent.kind} subtype={item.parent.subtype} size="sm" />
              <span className="tm-parentbox-main">
                <span className="tm-member-title">{item.parent.title}</span>
                <span className="tm-parentbox-sub">
                  <span className={`tm-parentbox-dot ${RELATION_DOT[item.relation]}`} aria-hidden />
                  {item.subtitle}
                </span>
              </span>
              {item.progress !== undefined ? <span className="tm-parentbox-pct">{item.progress}%</span> : null}
              {canOpen ? <span className="tm-member-arrow" aria-hidden>↗</span> : null}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
