"use client";

import { useState } from "react";
import { formatAbsoluteTime } from "@/lib/comments";
import type { cycleLogOf } from "@/lib/cycleLog";
import type { TaskRecord } from "@/lib/validation";
import { formatShortDate } from "./taskDates";

// Os checks de uma recorrência (data do check, ciclo e quem deu), do mais novo
// para o mais antigo. Mostra os últimos `limit` e expande sob pedido — a lista
// não rola por dentro do modal.
//
// Quando a execução daquele ciclo ainda existe, a linha vira o MESMO botão de
// abrir usado em "Faz parte de"/"Execuções" (.tm-member-open, via
// .tm-cyclelog-open) — não é uma segunda estrutura de navegação, é a mesma
// esticada para caber no grid do log. Um ciclo sem execução localizável
// (removida depois do check) fica só como texto, sem fingir ser clicável.

type CycleEntry = ReturnType<typeof cycleLogOf>[number];

export default function CycleChecks({
  log,
  executionByCycle,
  onOpen,
  limit = 3,
}: {
  log: CycleEntry[];
  /** A execução (se ainda existir) que cumpriu aquele ciclo, por número de ciclo. */
  executionByCycle?: (cycle: number) => TaskRecord | null;
  onOpen?: (execution: TaskRecord) => void;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = log.slice().reverse();
  if (!ordered.length) {
    return <p className="tm-cycles-empty">Nenhum check ainda. Cada ciclo concluído entra aqui com a data e quem concluiu.</p>;
  }
  const shown = showAll ? ordered : ordered.slice(0, limit);
  return (
    <>
      <ul className="tm-cyclelog-list">
        {shown.map((entry) => {
          const execution = executionByCycle?.(entry.cycle) ?? null;
          const rowContent = (
            <>
              <span className="tm-cyclelog-check" aria-hidden>✓</span>
              <span className="tm-cyclelog-when">{formatAbsoluteTime(entry.completed_at)}</span>
              <span className="tm-cyclelog-cycle">ciclo de {formatShortDate(entry.due_date)}</span>
              <b className="tm-cyclelog-by">{entry.by ?? "—"}</b>
            </>
          );
          return (
            <li key={`${entry.cycle}-${entry.completed_at}`}>
              {execution && onOpen ? (
                <button type="button" className="tm-cyclelog-open" title={`Abrir ${execution.title}`} onClick={() => onOpen(execution)}>
                  {rowContent}
                  <span className="tm-member-arrow" aria-hidden>↗</span>
                </button>
              ) : (
                <>
                  {rowContent}
                  <span aria-hidden />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {ordered.length > limit ? (
        <button type="button" className="tm-cycles-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Mostrar menos" : `Ver todos os ${ordered.length} checks`}
        </button>
      ) : null}
    </>
  );
}
