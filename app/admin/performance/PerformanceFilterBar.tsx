"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetaPlatform } from "@/lib/windsor";

export type PerfCategory = "ads" | "organico" | "ambos";
export type PerfFilterAttr = "cliente" | "categoria" | "rede";
export type PerfActiveFilter = { attr: PerfFilterAttr; value: string; label: string };

const CATEGORY_OPTIONS: { value: PerfCategory; label: string }[] = [
  { value: "ads", label: "Ads" },
  { value: "organico", label: "Orgânico" },
  { value: "ambos", label: "Ambos" },
];

const ATTR_DEFS: { key: PerfFilterAttr; label: string; icon: string }[] = [
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "categoria", label: "Categoria", icon: "◧" },
  { key: "rede", label: "Rede", icon: "◑" },
];
const ATTR_LABEL: Record<PerfFilterAttr, string> = Object.fromEntries(ATTR_DEFS.map((a) => [a.key, a.label])) as Record<PerfFilterAttr, string>;

export default function PerformanceFilterBar({
  clients,
  platformOptions,
  platformLabel,
  filters,
  onFiltersChange,
}: {
  clients: { slug: string; name: string }[];
  platformOptions: MetaPlatform[];
  platformLabel: Record<MetaPlatform, string>;
  filters: PerfActiveFilter[];
  onFiltersChange: (next: PerfActiveFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<PerfFilterAttr | null>(null);
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

  const valueOptions = useMemo((): { value: string; label: string }[] => {
    if (pendingAttr === "cliente") return clients.map((c) => ({ value: c.slug, label: c.name }));
    if (pendingAttr === "categoria") return CATEGORY_OPTIONS;
    if (pendingAttr === "rede") return platformOptions.map((p) => ({ value: p, label: platformLabel[p] }));
    return [];
  }, [pendingAttr, clients, platformOptions, platformLabel]);

  function addFilter(attr: PerfFilterAttr, value: string, label: string) {
    onFiltersChange([...filters.filter((f) => f.attr !== attr), { attr, value, label }]);
    setPendingAttr(null);
    setOpen(false);
  }
  function removeFilter(attr: PerfFilterAttr) {
    onFiltersChange(filters.filter((f) => f.attr !== attr));
  }

  const availableAttrs = ATTR_DEFS.filter((a) => !filters.some((f) => f.attr === a.key));

  return (
    <div className="kb-searchbar perf-filterbar" ref={ref}>
      <div className="kb-searchbar-box" onClick={() => setOpen(true)}>
        {filters.map((f) => (
          <span className="kb-filterchip" key={f.attr}>
            <b>{ATTR_LABEL[f.attr]}:</b> {f.label}
            <button type="button" aria-label={`Remover filtro ${ATTR_LABEL[f.attr]}`} onClick={(e) => { e.stopPropagation(); removeFilter(f.attr); }}>✕</button>
          </span>
        ))}
        {filters.length === 0 ? <span className="doc-filterbar-placeholder">Filtrar por cliente, categoria ou rede…</span> : null}
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
                {valueOptions.map((opt) => (
                  <button type="button" key={opt.value} className="kb-chip" onClick={() => addFilter(pendingAttr, opt.value, opt.label)}>{opt.label}</button>
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
