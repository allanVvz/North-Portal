"use client";

import { useEffect, useRef, useState } from "react";
import { SORT_DIR_LABEL, SORT_KEY_HINT, SORT_KEY_LABEL, type SortDir, type SortKey } from "./taskSort";
import type { SortPref } from "./taskSortPrefs";

// Botão de ordenamento (3 traços empilhados) + dropdown, ao lado da engrenagem
// de atributos. Mesma mecânica de popover do AttrVisibilityPopover:
// outside-click, Escape e aria-haspopup="menu".

const ORDERED_KEYS: SortKey[] = ["manual", "alfabetico", "edicao", "data"];
const DIRS: SortDir[] = ["asc", "desc"];

export default function SortMenu({
  sort,
  onChange,
  allowManual = false,
}: {
  sort: SortPref;
  onChange: (next: SortPref) => void;
  /** "Manual" só faz sentido onde arrastar realmente grava `tasks.position` —
   *  hoje apenas o Quadro de Tarefas no modo Kanban. Oferecer a opção onde ela
   *  não muda nada seria uma opção morta. */
  allowManual?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const keys = allowManual ? ORDERED_KEYS : ORDERED_KEYS.filter((key) => key !== "manual");
  // A preferência salva pode ser "manual" numa visão que não oferece manual
  // (o usuário escolheu no Quadro e depois abriu a Tabela): mostra o rótulo
  // real em vez de deixar o menu sem nada marcado.
  const activeLabel = SORT_KEY_LABEL[sort.key];

  return (
    <div className="kb-sortmenu" ref={ref}>
      <button
        type="button"
        className="admin-btn ghost kb-sort-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ordenar (${activeLabel})`}
        title={`Ordenar — ${activeLabel}`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden focusable="false">
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="10" y2="8" />
          <line x1="2" y1="12" x2="6" y2="12" />
        </svg>
      </button>
      {open ? (
        <div className="kb-sortmenu-panel" role="menu">
          <p className="kb-sortmenu-head">Ordenar por</p>
          {keys.map((key) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={sort.key === key}
              className={`kb-sortmenu-row ${sort.key === key ? "on" : ""}`}
              key={key}
              onClick={() => onChange({ ...sort, key })}
            >
              <span className="kb-sortmenu-mark" aria-hidden>{sort.key === key ? "●" : "○"}</span>
              <span className="kb-sortmenu-text">
                <strong>{SORT_KEY_LABEL[key]}</strong>
                <small>{SORT_KEY_HINT[key]}</small>
              </span>
            </button>
          ))}
          <div className="kb-sortmenu-dirs" role="group" aria-label="Direção">
            {DIRS.map((dir) => (
              <button
                type="button"
                className={sort.dir === dir ? "on" : ""}
                key={dir}
                aria-pressed={sort.dir === dir}
                onClick={() => onChange({ ...sort, dir })}
              >
                {dir === "asc" ? "↑" : "↓"} {SORT_DIR_LABEL[dir]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
