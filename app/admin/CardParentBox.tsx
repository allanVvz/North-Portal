"use client";

import TaskKindIcon from "./TaskKindIcon";
import type { TaskRecord } from "@/lib/validation";

export type ParentRelation = "entrega" | "plano" | "recorrencia";

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
  subtitle,
  progress,
  canOpen,
  onOpen,
}: {
  parent: TaskRecord;
  /** Ex.: "Etapa 2 de 4 · Captação", "Atividade do plano", "Execução da recorrência". */
  subtitle: string;
  /** Progresso do card pai, 0–100. */
  progress: number;
  canOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="tm-box tm-parentbox">
      <p className="tm-box-label">Faz parte de</p>
      <div className="tm-member-list">
        <div className="tm-member">
          <button type="button" className="tm-member-open" onClick={onOpen} disabled={!canOpen}>
            <TaskKindIcon kind={parent.kind} size="sm" />
            <span className="tm-parentbox-main">
              <span className="tm-member-title">{parent.title}</span>
              <span className="tm-parentbox-sub">{subtitle}</span>
            </span>
            <span className="tm-parentbox-pct">{progress}%</span>
            {canOpen ? <span className="tm-member-arrow" aria-hidden>↗</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
