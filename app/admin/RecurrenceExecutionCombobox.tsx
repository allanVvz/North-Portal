"use client";

import { useEffect, useRef, useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import { normalizeSearchText } from "@/lib/taskSearch";

// "Vincular execução existente" — a versão de recorrência do "Vincular
// existente" do PlanAddCombobox, sem as seções de criação em lote (conteúdo/
// tipos): aqui só faz sentido escolher UM card já existente para ocupar o
// ciclo corrente, nunca criar vários de uma vez. Reaproveita as mesmas
// classes CSS (.pac-*) para ficar visualmente igual ao "Adicionar ao plano".
export default function RecurrenceExecutionCombobox({
  candidates,
  templateKind,
  busy,
  onLink,
}: {
  candidates: { id: string; title: string; kind: string }[];
  /** `kind` do molde — só para ordenar candidatos do mesmo tipo primeiro
   * (preferência do usuário), nunca para excluir os demais. */
  templateKind: string;
  busy: boolean;
  onLink: (candidate: { id: string; title: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = normalizeSearchText(query.trim());
  const matches = (needle ? candidates.filter((c) => normalizeSearchText(c.title).includes(needle)) : candidates)
    .slice()
    .sort((a, b) => Number(b.kind === templateKind) - Number(a.kind === templateKind))
    .slice(0, 6);

  return (
    <div className={`pac${open ? " is-open" : ""}`} ref={ref}>
      <div className="pac-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <span className="pac-plus" aria-hidden>+</span>
        <input
          ref={inputRef}
          className="pac-input"
          role="combobox"
          aria-expanded={open}
          aria-label="Vincular execução existente"
          value={query}
          disabled={busy}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Vincular um card já existente como execução…"
        />
      </div>
      {open && matches.length ? (
        <div className="pac-panel">
          <div className="pac-section">
            <p className="pac-section-title">Vincular existente</p>
            {matches.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                className="pac-link"
                disabled={busy}
                onClick={() => { onLink(candidate); setQuery(""); setOpen(false); }}
              >
                <TaskKindIcon kind={candidate.kind} size="sm" />
                <span>{candidate.title}</span>
                <span className="pac-row-hint">vincular</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
