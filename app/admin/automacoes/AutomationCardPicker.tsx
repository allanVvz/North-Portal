"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRIORITY_LABEL } from "../kanbanShared";
import { taskMatchesFilters, type ActiveFilter, type FilterAttr } from "../KanbanSearchBar";
import { taskMatchesQuery } from "@/lib/taskSearch";
import { TASK_KIND_KEYS, kindLabel } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import TaskKindIcon from "../TaskKindIcon";

type Row = TaskRecord & { clientName?: string };

const ATTR_DEFS: { key: FilterAttr; label: string; icon: string }[] = [
  { key: "cliente", label: "Cliente", icon: "◔" },
  { key: "tipo", label: "Tipo", icon: "◧" },
  { key: "prioridade", label: "Prioridade", icon: "⚑" },
  { key: "responsavel", label: "Responsável", icon: "◑" },
];
const ATTR_LABEL: Record<FilterAttr, string> = Object.fromEntries(ATTR_DEFS.map((a) => [a.key, a.label])) as Record<FilterAttr, string>;

// Busca composta para escolher o card-modelo de uma automação — base
// compartilhada com KanbanSearchBar.tsx (mesmos chips/atributos), mas aqui
// escolher QUALQUER atributo já revela a lista de cards correspondentes (o
// "avançar para mostrar os cards" pedido para Cliente/Tipo generaliza para os
// 4 — não há board externo para filtrar, o único objetivo é escolher um
// card), até 5 resultados por vez, e clicar num resultado seleciona aquele
// card como modelo em vez de navegar até ele.
export default function AutomationCardPicker({ tasks, onPick }: { tasks: Row[]; onPick: (task: Row) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
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

  function valueKeyFor(attr: FilterAttr, label: string): string {
    if (attr === "tipo") return TASK_KIND_KEYS.find((k) => kindLabel(k) === label) ?? label;
    if (attr === "prioridade") return Object.entries(PRIORITY_LABEL).find(([, l]) => l === label)?.[0] ?? label;
    return label;
  }

  function addFilter(attr: FilterAttr, label: string) {
    const value = valueKeyFor(attr, label);
    setFilters((current) => [...current.filter((f) => f.attr !== attr), { attr, value, label }]);
    setPendingAttr(null);
  }
  function removeFilter(attr: FilterAttr) {
    setFilters((current) => current.filter((f) => f.attr !== attr));
  }

  const results = useMemo(() => {
    const filtered = filters.length ? tasks.filter((t) => taskMatchesFilters(t, filters)) : tasks;
    const needle = q.trim();
    const byText = needle ? filtered.filter((t) => taskMatchesQuery(t, needle, { clientName: t.clientName ?? "" })) : filtered;
    return byText.slice(0, 5);
  }, [tasks, q, filters]);

  const showResults = filters.length > 0 || q.trim().length > 0;
  const availableAttrs = ATTR_DEFS.filter((a) => !filters.some((f) => f.attr === a.key));

  function pick(task: Row) {
    onPick(task);
    setOpen(false);
    setQ("");
    setFilters([]);
    setPendingAttr(null);
  }

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
          onChange={(e) => { setQ(e.target.value); setPendingAttr(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={filters.length ? "Buscar por título…" : "Buscar card-modelo por cliente, tipo, prioridade, responsável ou título…"}
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
              {showResults ? (
                <div className="kb-searchbar-results">
                  {results.length ? (
                    results.map((t) => (
                      <button type="button" className="kb-searchbar-result" key={t.id} onClick={() => pick(t)}>
                        <TaskKindIcon kind={t.kind} size="sm" />
                        <span className="kb-searchbar-result-title">{t.title}</span>
                        {t.clientName ? <span className="kb-searchbar-result-client">{t.clientName}</span> : null}
                      </button>
                    ))
                  ) : (
                    <p className="admin-sub kb-searchbar-empty">Nenhum card encontrado.</p>
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
