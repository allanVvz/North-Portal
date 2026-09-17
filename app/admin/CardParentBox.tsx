"use client";

import TaskKindIcon from "./TaskKindIcon";
import type { TaskRecord } from "@/lib/validation";

export type ParentRelation = "entrega" | "plano" | "recorrencia" | "referencia";

// Um marcador fixo por TIPO DE RELAÇÃO (não pelo kind do card de destino) —
// sem isto, duas caixas "Faz parte de" só se distinguiam pelo texto do
// subtítulo, e uma relação de Plano e uma de Recorrência-para-um-Plano
// podiam sair na MESMA cor (a do ícone do destino, que é `plano_acao` nos
// dois casos). O ponto colorido aqui identifica a RELAÇÃO em si, de relance.
const RELATION_DOT: Record<ParentRelation, string> = {
  entrega: "tm-parentbox-dot-entrega",
  plano: "tm-parentbox-dot-plano",
  recorrencia: "tm-parentbox-dot-recorrencia",
  referencia: "tm-parentbox-dot-referencia",
};

// A caixa "Faz parte de" do modal de um card FILHO — etapa de uma entrega,
// atividade de um plano ou execução de uma recorrência.
//
// Enxuta e só de navegação: uma linha com o card pai (clicável, com o progresso
// dele) e um subtítulo dizendo qual é a relação. Sem lista de irmãos, sem 🔗,
// sem ✕ — quem quer ver ou mexer nos irmãos abre o pai. É o mesmo desenho para
// os três tipos de pai, no lugar dos dois boxes que a etapa de fluxo tinha e do
// nada que a atividade de plano tinha.
export default function CardParentBox({
  parent,
  relation,
  subtitle,
  progress,
  canOpen,
  onOpen,
}: {
  parent: TaskRecord;
  /** Que TIPO de relação isto é — não o kind do `parent`. Decide a cor do
   * marcador (RELATION_DOT), não o ícone (que continua sendo o do `parent`). */
  relation: ParentRelation;
  /** Ex.: "Etapa 2 de 4 · Captação", "Atividade do plano", "Execução da recorrência". */
  subtitle: string;
  /** Progresso do card pai, 0–100. Referências não exibem percentual porque
   * não participam do rollup da família atual. */
  progress?: number;
  canOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="tm-box tm-parentbox">
      <p className="tm-box-label">{relation === "referencia" ? "Relacionado a" : "Faz parte de"}</p>
      <div className="tm-member-list">
        <div className="tm-member">
          <button type="button" className="tm-member-open" onClick={onOpen} disabled={!canOpen}>
            <TaskKindIcon kind={parent.kind} size="sm" />
            <span className="tm-parentbox-main">
              <span className="tm-member-title">{parent.title}</span>
              <span className="tm-parentbox-sub">
                <span className={`tm-parentbox-dot ${RELATION_DOT[relation]}`} aria-hidden />
                {subtitle}
              </span>
            </span>
            {progress !== undefined ? <span className="tm-parentbox-pct">{progress}%</span> : null}
            {canOpen ? <span className="tm-member-arrow" aria-hidden>↗</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
