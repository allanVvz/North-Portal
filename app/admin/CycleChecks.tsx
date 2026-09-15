"use client";

import { useState } from "react";
import { formatAbsoluteTime } from "@/lib/comments";
import type { cycleLogOf } from "@/lib/cycleLog";
import { formatShortDate } from "./taskDates";

// Os checks de uma recorrência (data do check, ciclo e quem deu), do mais novo
// para o mais antigo. Mostra os últimos `limit` e expande sob pedido — a lista
// não rola por dentro do modal.

type CycleEntry = ReturnType<typeof cycleLogOf>[number];

export default function CycleChecks({ log, limit = 3 }: { log: CycleEntry[]; limit?: number }) {
  const [showAll, setShowAll] = useState(false);
  const ordered = log.slice().reverse();
  if (!ordered.length) {
    return <p className="tm-cycles-empty">Nenhum check ainda. Cada ciclo concluído entra aqui com a data e quem concluiu.</p>;
  }
  const shown = showAll ? ordered : ordered.slice(0, limit);
  return (
    <>
      <ul className="tm-cyclelog-list">
        {shown.map((entry) => (
          <li key={`${entry.cycle}-${entry.completed_at}`}>
            <span className="tm-cyclelog-check" aria-hidden>✓</span>
            <span className="tm-cyclelog-when">{formatAbsoluteTime(entry.completed_at)}</span>
            <span className="tm-cyclelog-cycle">ciclo de {formatShortDate(entry.due_date)}</span>
            <b className="tm-cyclelog-by">{entry.by ?? "—"}</b>
          </li>
        ))}
      </ul>
      {ordered.length > limit ? (
        <button type="button" className="tm-cycles-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Mostrar menos" : `Ver todos os ${ordered.length} checks`}
        </button>
      ) : null}
    </>
  );
}
