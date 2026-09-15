"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeText } from "@/lib/northai/formats";

// O dropdown composto das operações (o mesmo visual da caixa de busca e filtro
// do quadro, KanbanSearchBar): uma caixa que mostra o valor como chip e, ao
// clicar, abre o painel com as opções — com busca quando a lista é longa.

export type ComboOption = { value: string; label: string; hint?: string };

export default function ComboField({
  label,
  value,
  options,
  onChange,
  placeholder = "escolher",
  emptyLabel,
  size,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mostra uma opção "vazia" (ex.: "Sem responsável"). */
  emptyLabel?: string;
  size?: "lg" | "sm";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

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

  const selected = options.find((option) => option.value === value) ?? null;
  const searchable = options.length > 6;
  const needle = normalizeText(query.trim());
  const filtered = needle ? options.filter((option) => normalizeText(option.label).includes(needle)) : options;

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`kb-searchbar nai-combo${size ? ` is-${size}` : ""}`} ref={ref}>
      <button
        type="button"
        className="kb-searchbar-box nai-combo-box"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <span className="kb-filterchip nai-combo-chip"><b>{label}:</b> {selected.label}</span>
        ) : value === "" && emptyLabel ? (
          <span className="kb-filterchip nai-combo-chip is-empty"><b>{label}:</b> {emptyLabel}</span>
        ) : (
          <span className="nai-combo-placeholder">{label} · {placeholder}</span>
        )}
        <span className="nai-combo-caret" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="kb-searchbar-panel nai-combo-panel">
          <div className="kb-searchbar-panelhead"><span>{label}</span></div>
          {searchable ? (
            <input className="kb-searchbar-input nai-combo-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar…" aria-label={`Buscar ${label}`} />
          ) : null}
          <div className="kb-searchbar-attrlist" role="listbox" aria-label={label}>
            {emptyLabel !== undefined && !needle ? (
              <button type="button" role="option" aria-selected={value === ""} className={`kb-searchbar-attr${value === "" ? " is-on" : ""}`} onClick={() => pick("")}>
                <span>{emptyLabel}</span>
              </button>
            ) : null}
            {filtered.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                key={option.value}
                className={`kb-searchbar-attr${option.value === value ? " is-on" : ""}`}
                onClick={() => pick(option.value)}
              >
                <span>{option.label}</span>
                {option.hint ? <em>{option.hint}</em> : null}
              </button>
            ))}
            {!filtered.length ? <p className="admin-sub kb-searchbar-empty">Nada encontrado.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
