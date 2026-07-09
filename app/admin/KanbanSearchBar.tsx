"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { matchesQuery, PRIORITY_LABEL } from "./kanbanShared";
import { TASK_KIND_KEYS, kindLabel, kindTone } from "@/lib/taskCatalog";
import type { TaskPriority, TaskRecord } from "@/lib/validation";

type Row = TaskRecord & { clientName?: string };

// Unified search/filter surface for the Kanban header — replaces the old
// standalone Tipo/Prioridade <select> dropdowns. A single styled text input
// opens a dropdown on focus with clickable kind/priority chips plus a live
// autocomplete list of matching tasks. All matching is plain client-side
// `.includes()` against already-fetched tasks (see kanbanShared.matchesQuery)
// — no eval, no dynamic RegExp built from user input.
export default function KanbanSearchBar({
  q,
  onQChange,
  fKind,
  onFKindChange,
  fPrio,
  onFPrioChange,
  tasks,
  crossClient,
  onPickTask,
}: {
  q: string;
  onQChange: (value: string) => void;
  fKind: string;
  onFKindChange: (value: string) => void;
  fPrio: TaskPriority | "";
  onFPrioChange: (value: TaskPriority | "") => void;
  tasks: Row[];
  crossClient: boolean;
  onPickTask: (id: string) => void;
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

  const results = useMemo(() => {
    const needle = q.trim();
    if (!needle) return [];
    return tasks.filter((t) => matchesQuery(t, needle, t.clientName ?? "")).slice(0, 8);
  }, [tasks, q]);

  return (
    <div className="kb-searchbar" ref={ref}>
      <input
        className="kb-searchbar-input"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Buscar por título, tipo, prioridade, prazo, cliente…"
      />
      {open ? (
        <div className="kb-searchbar-panel">
          <div className="kb-searchbar-chips">
            {TASK_KIND_KEYS.map((k) => (
              <button
                type="button"
                key={k}
                className={`kb-chip ${fKind === k ? "on" : ""}`}
                aria-pressed={fKind === k}
                onClick={() => onFKindChange(fKind === k ? "" : k)}
              >
                {kindLabel(k)}
              </button>
            ))}
            {(Object.entries(PRIORITY_LABEL) as [TaskPriority, string][]).map(([v, l]) => (
              <button
                type="button"
                key={v}
                className={`kb-chip kb-chip-prio p-${v} ${fPrio === v ? "on" : ""}`}
                aria-pressed={fPrio === v}
                onClick={() => onFPrioChange(fPrio === v ? "" : v)}
              >
                {l}
              </button>
            ))}
          </div>
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
                    <span className={`kb-type t-tone-${kindTone(t.kind)}`}>{kindLabel(t.kind)}</span>
                    <span className="kb-searchbar-result-title">{t.title}</span>
                    {crossClient && t.clientName ? <span className="kb-searchbar-result-client">{t.clientName}</span> : null}
                  </button>
                ))
              ) : (
                <p className="admin-sub kb-searchbar-empty">Nenhuma tarefa encontrada.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
