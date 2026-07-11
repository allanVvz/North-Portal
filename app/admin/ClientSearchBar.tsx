"use client";

import { useEffect, useRef, useState } from "react";
import { STAGE_LABEL, STAGE_ORDER } from "./clientPipeline";
import type { ClientRow } from "./ClientsTable";

export type ClientFilterAttr = "status" | "briefing" | "etapa" | "desabilitado";
export type ClientActiveFilter = { attr: ClientFilterAttr; value: string; label: string };

const ATTR_DEFS: { key: ClientFilterAttr; label: string; icon: string }[] = [
  { key: "status", label: "Status", icon: "◔" },
  { key: "briefing", label: "Briefing", icon: "◧" },
  { key: "etapa", label: "Etapa", icon: "◑" },
  { key: "desabilitado", label: "Desabilitado", icon: "⚑" },
];
const ATTR_LABEL: Record<ClientFilterAttr, string> = Object.fromEntries(ATTR_DEFS.map((a) => [a.key, a.label])) as Record<ClientFilterAttr, string>;

const VALUE_OPTIONS: Record<ClientFilterAttr, string[]> = {
  status: ["Ativo", "Inativo"],
  briefing: ["Enviado", "Pendente"],
  etapa: STAGE_ORDER.map((s) => STAGE_LABEL[s]),
  desabilitado: ["Sim", "Não"],
};

// Same value = comparable-to-task, exact attribute matches; used to filter
// disabled clients OUT by default (see ClientsTable) unless explicitly
// searching for them.
export function clientMatchesFilters(c: ClientRow, filters: ClientActiveFilter[]): boolean {
  return filters.every((f) => {
    if (f.attr === "status") return (c.is_active ? "Ativo" : "Inativo") === f.value;
    if (f.attr === "briefing") return (c.briefing_submitted ? "Enviado" : "Pendente") === f.value;
    if (f.attr === "desabilitado") return (c.disabled ? "Sim" : "Não") === f.value;
    return STAGE_LABEL[c.stage] === f.value;
  });
}

// Composite attribute->value filter, same interaction pattern as
// app/admin/KanbanSearchBar.tsx (pick an attribute, then its value, each
// pick becomes a removable "E"-composable chip) — reused here for Clientes
// instead of building a second, different filter UI.
export default function ClientSearchBar({
  q,
  onQChange,
  filters,
  onFiltersChange,
}: {
  q: string;
  onQChange: (value: string) => void;
  filters: ClientActiveFilter[];
  onFiltersChange: (next: ClientActiveFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<ClientFilterAttr | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPendingAttr(null); }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setPendingAttr(null); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function addFilter(attr: ClientFilterAttr, value: string) {
    onFiltersChange([...filters.filter((f) => f.attr !== attr), { attr, value, label: value }]);
    setPendingAttr(null);
    setOpen(false);
  }
  function removeFilter(attr: ClientFilterAttr) {
    onFiltersChange(filters.filter((f) => f.attr !== attr));
  }

  const availableAttrs = ATTR_DEFS.filter((a) => !filters.some((f) => f.attr === a.key));

  return (
    <div className="kb-searchbar" ref={ref}>
      <div className="kb-searchbar-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {filters.map((f) => (
          <span className="kb-filterchip" key={f.attr}>
            <b>{ATTR_LABEL[f.attr]}:</b> {f.label}
            <button type="button" aria-label={`Remover filtro ${ATTR_LABEL[f.attr]}`} onClick={(e) => { e.stopPropagation(); removeFilter(f.attr); }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="kb-searchbar-input"
          value={q}
          onChange={(e) => { onQChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={filters.length ? "Buscar por nome ou slug…" : "Filtrar por status, briefing, etapa ou buscar por nome…"}
        />
      </div>
      {open ? (
        <div className="kb-searchbar-panel">
          {pendingAttr ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPendingAttr(null)}>‹ Voltar</button>
                <span>{ATTR_LABEL[pendingAttr]}</span>
              </div>
              <div className="kb-searchbar-chips">
                {VALUE_OPTIONS[pendingAttr].map((label) => (
                  <button type="button" key={label} className="kb-chip" onClick={() => addFilter(pendingAttr, label)}>{label}</button>
                ))}
              </div>
            </>
          ) : availableAttrs.length ? (
            <>
              <div className="kb-searchbar-panelhead"><span>{filters.length ? "+ Adicionar filtro (E)" : "Filtrar por atributo"}</span></div>
              <div className="kb-searchbar-attrlist">
                {availableAttrs.map((a) => (
                  <button type="button" key={a.key} className="kb-searchbar-attr" onClick={() => setPendingAttr(a.key)}>
                    <span aria-hidden>{a.icon}</span>{a.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
