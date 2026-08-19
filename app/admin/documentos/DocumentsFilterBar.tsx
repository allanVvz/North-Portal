"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminDocument } from "@/lib/supabase";
import type { DocumentStatus, DocumentType } from "@/lib/validation";

export type DocFilterAttr = "cliente" | "tipo" | "status" | "data";
export type DocActiveFilter = { attr: DocFilterAttr; value: string; label: string };

const ATTR_DEFS: { key: DocFilterAttr; label: string; icon: string }[] = [
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "tipo", label: "Tipo", icon: "◧" },
  { key: "status", label: "Status", icon: "◑" },
  { key: "data", label: "Data", icon: "▦" },
];
const ATTR_LABEL: Record<DocFilterAttr, string> = Object.fromEntries(ATTR_DEFS.map((a) => [a.key, a.label])) as Record<DocFilterAttr, string>;

export function documentMatchesFilters(d: AdminDocument, filters: DocActiveFilter[], typeLabel: Record<DocumentType, string>, statusLabel: Record<DocumentStatus, string>): boolean {
  return filters.every((f) => {
    if (f.attr === "cliente") return d.clientName === f.value;
    if (f.attr === "tipo") return typeLabel[d.doc_type] === f.value;
    if (f.attr === "status") return statusLabel[d.status] === f.value;
    return (d.doc_date || "Sem data") === f.value;
  });
}

export default function DocumentsFilterBar({
  docs,
  filters,
  onFiltersChange,
  typeLabel,
  statusLabel,
}: {
  docs: AdminDocument[];
  filters: DocActiveFilter[];
  onFiltersChange: (next: DocActiveFilter[]) => void;
  typeLabel: Record<DocumentType, string>;
  statusLabel: Record<DocumentStatus, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<DocFilterAttr | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  const valueOptions = useMemo(() => {
    if (!pendingAttr) return [];
    if (pendingAttr === "cliente") return Array.from(new Set(docs.map((d) => d.clientName))).sort((a, b) => a.localeCompare(b));
    if (pendingAttr === "tipo") return Array.from(new Set(docs.map((d) => typeLabel[d.doc_type])));
    if (pendingAttr === "status") return Array.from(new Set(docs.map((d) => statusLabel[d.status])));
    return Array.from(new Set(docs.map((d) => d.doc_date || "Sem data"))).sort((a, b) => (a === "Sem data" ? 1 : b === "Sem data" ? -1 : b.localeCompare(a)));
  }, [pendingAttr, docs, typeLabel, statusLabel]);

  function addFilter(attr: DocFilterAttr, value: string) {
    onFiltersChange([...filters.filter((f) => f.attr !== attr), { attr, value, label: value }]);
    setPendingAttr(null);
    setOpen(false);
  }
  function removeFilter(attr: DocFilterAttr) {
    onFiltersChange(filters.filter((f) => f.attr !== attr));
  }

  const availableAttrs = ATTR_DEFS.filter((a) => !filters.some((f) => f.attr === a.key));

  return (
    <div className="kb-searchbar doc-filterbar" ref={ref}>
      <div className="kb-searchbar-box" onClick={() => setOpen(true)}>
        {filters.map((f) => (
          <span className="kb-filterchip" key={f.attr}>
            <b>{ATTR_LABEL[f.attr]}:</b> {f.label}
            <button type="button" aria-label={`Remover filtro ${ATTR_LABEL[f.attr]}`} onClick={(e) => { e.stopPropagation(); removeFilter(f.attr); }}>✕</button>
          </span>
        ))}
        {filters.length === 0 ? <span className="doc-filterbar-placeholder">Filtrar por cliente, tipo, status ou data…</span> : null}
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
                {valueOptions.map((label) => (
                  <button type="button" key={label} className="kb-chip" onClick={() => addFilter(pendingAttr, label)}>{label}</button>
                ))}
                {valueOptions.length === 0 ? <p className="admin-sub kb-searchbar-empty">Nenhum valor disponível.</p> : null}
              </div>
            </>
          ) : (
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
          )}
        </div>
      ) : null}
    </div>
  );
}
