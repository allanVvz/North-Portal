"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { matchesQuery, PRIORITY_LABEL } from "./kanbanShared";
import { TASK_KIND_KEYS, kindLabel } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import TaskKindIcon from "./TaskKindIcon";

type Row = TaskRecord & { clientName?: string };

export type FilterAttr = "cliente" | "tipo" | "prioridade" | "responsavel";
export type ActiveFilter = { attr: FilterAttr; value: string; label: string };

const ATTR_DEFS: { key: FilterAttr; label: string; icon: string }[] = [
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "tipo", label: "Tipo", icon: "◧" },
  { key: "prioridade", label: "Prioridade", icon: "⚑" },
  { key: "responsavel", label: "Responsável", icon: "◑" },
];
const ATTR_LABEL: Record<FilterAttr, string> = Object.fromEntries(ATTR_DEFS.map((a) => [a.key, a.label])) as Record<FilterAttr, string>;

export function taskMatchesFilters(t: Row, filters: ActiveFilter[]): boolean {
  return filters.every((f) => {
    if (f.attr === "cliente") return (t.clientName ?? "Outros") === f.value;
    if (f.attr === "tipo") return t.kind === f.value;
    if (f.attr === "prioridade") return t.priority === f.value;
    return (t.assignee?.trim() || "Sem responsável") === f.value;
  });
}

// A two-level composable filter: pick an attribute (Cliente/Tipo/Prioridade/
// Responsável) first, then its specific value — each pick becomes a removable
// chip, AND'd with any others, so several attributes can be composed
// together ("E"). A free-text field alongside it still does a quick
// title/description/etc. search with a jump-to-task results list, same as
// before — the two modes share one box but don't interfere with each other.
export default function KanbanSearchBar({
  q,
  onQChange,
  filters,
  onFiltersChange,
  tasks,
  onPickTask,
}: {
  q: string;
  onQChange: (value: string) => void;
  filters: ActiveFilter[];
  onFiltersChange: (next: ActiveFilter[]) => void;
  tasks: Row[];
  onPickTask: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingAttr, setPendingAttr] = useState<FilterAttr | null>(null);
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

  const valueOptions = useMemo(() => {
    if (!pendingAttr) return [];
    if (pendingAttr === "cliente") {
      return Array.from(new Set(tasks.map((t) => t.clientName ?? "Outros"))).sort((a, b) => (a === "Outros" ? 1 : b === "Outros" ? -1 : a.localeCompare(b)));
    }
    if (pendingAttr === "tipo") return TASK_KIND_KEYS.map((k) => kindLabel(k));
    if (pendingAttr === "prioridade") return Object.values(PRIORITY_LABEL);
    return Array.from(new Set(tasks.map((t) => t.assignee?.trim() || "Sem responsável"))).sort((a, b) => (a === "Sem responsável" ? 1 : b === "Sem responsável" ? -1 : a.localeCompare(b)));
  }, [pendingAttr, tasks]);

  // Tipo/Prioridade values are stored as raw keys (kind/priority), everything
  // else is already the display value — this maps a picked label back to the
  // value actually compared against tasks.
  function valueKeyFor(attr: FilterAttr, label: string): string {
    if (attr === "tipo") return TASK_KIND_KEYS.find((k) => kindLabel(k) === label) ?? label;
    if (attr === "prioridade") {
      return (Object.entries(PRIORITY_LABEL).find(([, l]) => l === label)?.[0] ?? label);
    }
    return label;
  }

  function addFilter(attr: FilterAttr, label: string) {
    const value = valueKeyFor(attr, label);
    onFiltersChange([...filters.filter((f) => f.attr !== attr), { attr, value, label }]);
    setPendingAttr(null);
    setOpen(false);
  }
  function removeFilter(attr: FilterAttr) {
    onFiltersChange(filters.filter((f) => f.attr !== attr));
  }

  const results = useMemo(() => {
    const needle = q.trim();
    if (!needle) return [];
    return tasks.filter((t) => matchesQuery(t, needle, t.clientName ?? "")).slice(0, 8);
  }, [tasks, q]);

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
          onChange={(e) => { onQChange(e.target.value); setPendingAttr(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={filters.length ? "Buscar por título…" : "Filtrar por cliente, tipo, prioridade, responsável ou buscar por título…"}
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
                {valueOptions.map((label) => (
                  <button type="button" key={label} className="kb-chip" onClick={() => addFilter(pendingAttr, label)}>{label}</button>
                ))}
                {valueOptions.length === 0 ? <p className="admin-sub kb-searchbar-empty">Nenhum valor disponível.</p> : null}
              </div>
            </>
          ) : (
            <>
              {availableAttrs.length ? (
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
              {q.trim() ? (
                <div className="kb-searchbar-results">
                  {results.length ? (
                    results.map((t) => (
                      <button
                        type="button"
                        className="kb-searchbar-result"
                        key={t.id}
                        onClick={() => { onPickTask(t.id); setOpen(false); }}
                      >
                        <TaskKindIcon kind={t.kind} size="sm" />
                        <span className="kb-searchbar-result-title">{t.title}</span>
                        {t.clientName ? <span className="kb-searchbar-result-client">{t.clientName}</span> : null}
                      </button>
                    ))
                  ) : (
                    <p className="admin-sub kb-searchbar-empty">Nenhuma tarefa encontrada.</p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
