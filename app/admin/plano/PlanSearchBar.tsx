"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionPlan } from "@/lib/supabase";

// Same input+dropdown pattern as KanbanSearchBar (app/admin/KanbanSearchBar.tsx),
// adapted for plans: chips fill the textbox instead of toggling separate filter
// state, since a single free-text query already covers cliente/responsável/data
// here (see planMatches in ActionPlansBoard). Empty text = "Todos os clientes".
export default function PlanSearchBar({
  q,
  onQChange,
  plans,
}: {
  q: string;
  onQChange: (value: string) => void;
  plans: ActionPlan[];
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

  const clientNames = Array.from(new Set(plans.map((p) => p.clientName).filter(Boolean))).sort();
  const assignees = Array.from(
    new Set([
      ...plans.map((p) => p.assignee).filter((a): a is string => Boolean(a && a.trim())),
      ...plans.flatMap((p) => p.activities.map((a) => a.assignee).filter((a): a is string => Boolean(a && a.trim()))),
    ]),
  ).sort();

  return (
    <div className="kb-searchbar" ref={ref}>
      <input
        className="kb-searchbar-input"
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Todos os clientes · buscar por cliente, responsável, prazo…"
      />
      {q ? (
        <button type="button" className="kb-searchbar-clear" aria-label="Limpar busca" onClick={() => onQChange("")}>✕</button>
      ) : null}
      {open ? (
        <div className="kb-searchbar-panel">
          {clientNames.length ? (
            <div className="kb-searchbar-chips">
              {clientNames.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`kb-chip ${q === name ? "on" : ""}`}
                  aria-pressed={q === name}
                  onClick={() => { onQChange(q === name ? "" : name); setOpen(false); }}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          {assignees.length ? (
            <div className="kb-searchbar-chips">
              {assignees.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`kb-chip ${q === name ? "on" : ""}`}
                  aria-pressed={q === name}
                  onClick={() => { onQChange(q === name ? "" : name); setOpen(false); }}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
