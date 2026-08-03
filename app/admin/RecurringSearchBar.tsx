"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecurringTask } from "@/lib/supabase";
import { kindLabel } from "@/lib/taskCatalog";
import { PRIORITY_LABEL } from "./kanbanShared";
import { RECURRING_STATES, RECURRING_STATE_LABEL } from "./recurringState";
import { recurringAssigneeOptions, recurringSearchText, type RecurringActiveFilter, type RecurringFilterAttr } from "./recurringTaskFilters";

export type { RecurringActiveFilter } from "./recurringTaskFilters";

// Cliente is the first attribute, matching KanbanSearchBar — the board has no
// client dropdown either, it is just another composable chip.
const ATTRS: { key: RecurringFilterAttr; label: string; icon: string }[] = [
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "tipo", label: "Tipo", icon: "◇" },
  { key: "frequencia", label: "Frequência", icon: "↻" },
  { key: "prioridade", label: "Prioridade", icon: "⚑" },
  { key: "responsavel", label: "Responsável", icon: "◉" },
  { key: "estado", label: "Estado", icon: "●" },
];
const ATTR_LABEL = Object.fromEntries(ATTRS.map((attr) => [attr.key, attr.label])) as Record<RecurringFilterAttr, string>;

export default function RecurringSearchBar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  tasks,
  onPick,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filters: RecurringActiveFilter[];
  onFiltersChange: (filters: RecurringActiveFilter[]) => void;
  tasks: RecurringTask[];
  onPick: (task: RecurringTask) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<RecurringFilterAttr | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setPendingAttr(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setPendingAttr(null);
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const values = useMemo(() => {
    if (pendingAttr === "cliente") {
      return Array.from(new Set(tasks.map((task) => task.clientName)))
        .sort((a, b) => a.localeCompare(b, "pt-BR"))
        .map((value) => ({ value, label: value }));
    }
    if (pendingAttr === "tipo") return Array.from(new Set(tasks.map((task) => task.kind))).map((value) => ({ value, label: kindLabel(value) }));
    if (pendingAttr === "frequencia") return [
      { value: "semanal", label: "Semanal" },
      { value: "quinzenal", label: "Quinzenal" },
      { value: "mensal", label: "Mensal" },
    ];
    if (pendingAttr === "prioridade") return Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
    if (pendingAttr === "estado") return RECURRING_STATES.map((value) => ({ value, label: RECURRING_STATE_LABEL[value] }));
    if (pendingAttr === "responsavel") return recurringAssigneeOptions(tasks).map((value) => ({ value, label: value }));
    return [];
  }, [pendingAttr, tasks]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return [];
    return tasks.filter((task) => recurringSearchText(task).includes(needle)).slice(0, 8);
  }, [query, tasks]);

  function addFilter(attr: RecurringFilterAttr, value: string, label: string) {
    onFiltersChange([...filters.filter((filter) => filter.attr !== attr), { attr, value, label }]);
    setPendingAttr(null);
    setOpen(false);
  }

  return (
    <div className="kb-searchbar" ref={rootRef}>
      <div className="kb-searchbar-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {filters.map((filter) => (
          <span className="kb-filterchip" key={filter.attr}>
            <b>{ATTR_LABEL[filter.attr]}:</b> {filter.label}
            <button type="button" aria-label={`Remover filtro ${ATTR_LABEL[filter.attr]}`} onClick={(event) => { event.stopPropagation(); onFiltersChange(filters.filter((item) => item.attr !== filter.attr)); }}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="kb-searchbar-input"
          value={query}
          onChange={(event) => { onQueryChange(event.target.value); setPendingAttr(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={filters.length ? "Buscar rotina…" : "Filtrar por tipo, frequência, prioridade, responsável ou buscar…"}
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
                {values.map((option) => <button type="button" className="kb-chip" key={option.value} onClick={() => addFilter(pendingAttr, option.value, option.label)}>{option.label}</button>)}
              </div>
            </>
          ) : (
            <>
              <div className="kb-searchbar-panelhead"><span>{filters.length ? "+ Adicionar filtro" : "Filtrar por atributo"}</span></div>
              <div className="kb-searchbar-attrlist">
                {ATTRS.filter((attr) => !filters.some((filter) => filter.attr === attr.key)).map((attr) => (
                  <button type="button" className="kb-searchbar-attr" key={attr.key} onClick={() => setPendingAttr(attr.key)}><span aria-hidden>{attr.icon}</span>{attr.label}</button>
                ))}
              </div>
              {query.trim() ? (
                <div className="kb-searchbar-results">
                  {results.length ? results.map((task) => (
                    <button type="button" className="kb-searchbar-result" key={task.id} onClick={() => { onPick(task); setOpen(false); }}>
                      <span className="kb-searchbar-result-title">{task.title}</span>
                      <span className="kb-searchbar-result-client">{task.clientName}</span>
                    </button>
                  )) : <p className="admin-sub kb-searchbar-empty">Nenhuma rotina encontrada.</p>}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
