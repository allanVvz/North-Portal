"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import { agencyToday } from "./recurringState";
import { normalizeSearchText } from "@/lib/taskSearch";

type Candidate = { id: string; title: string; kind: string; due_date?: string | null };

export default function RecurrenceExecutionCombobox({ candidates, templateKind, busy, onLink, onCreate }: {
  candidates: Candidate[]; templateKind: string; busy: boolean;
  onLink: (candidate: Candidate, date: string) => void;
  onCreate: (dates: string[], title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"link" | "create">("link");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const needle = normalizeSearchText(query.trim());
  const matches = useMemo(() => (needle ? candidates.filter((candidate) => normalizeSearchText(candidate.title).includes(needle)) : candidates)
    .slice().sort((a, b) => Number(b.kind === templateKind) - Number(a.kind === templateKind)).slice(0, 8), [candidates, needle, templateKind]);

  function addDate() {
    if (!date || dates.includes(date)) return;
    setDates((current) => [...current, date].sort());
    setDate("");
  }
  function create() {
    if (!dates.length || busy) return;
    onCreate(dates, query.trim());
    setDates([]); setQuery(""); setDate(""); setOpen(false);
  }

  return <div className={`pac${open ? " is-open" : ""}`} ref={ref}>
    <div className="pac-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
      <span className="pac-plus" aria-hidden>+</span>
      <input ref={inputRef} className="pac-input" role="combobox" aria-expanded={open} aria-label="Adicionar execução da recorrência" value={query} disabled={busy}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder={mode === "link" ? "Buscar execução existente…" : "Nome da nova execução (opcional)…"} />
    </div>
    {open ? <div className="pac-panel">
      <nav className="pac-mode" aria-label="Como adicionar execução"><button type="button" className={mode === "link" ? "on" : ""} aria-pressed={mode === "link"} onClick={() => { setMode("link"); setQuery(""); }}>Vincular existente</button><button type="button" className={mode === "create" ? "on" : ""} aria-pressed={mode === "create"} onClick={() => { setMode("create"); setQuery(""); }}>Criar nova</button></nav>
      {mode === "link" ? <div className="pac-section">
        <p className="pac-section-title">Cards disponíveis<span>Escolha a data desta execução</span></p>
        {matches.map((candidate) => <div className="pac-link-row" key={candidate.id}>
          <TaskKindIcon kind={candidate.kind} size="sm" /><span title={candidate.title}>{candidate.title}</span>
          <input aria-label={`Data de ${candidate.title}`} type="date" defaultValue={candidate.due_date ?? ""} />
          <button type="button" disabled={busy} onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null; onLink(candidate, input?.value || candidate.due_date || agencyToday()); setOpen(false); }}>Vincular</button>
        </div>)}
        {!matches.length ? <p className="admin-sub pac-empty">Nenhuma execução encontrada. Use “Criar nova” para adicionar uma.</p> : null}
      </div> : <div className="pac-section">
        <p className="pac-section-title">Datas das novas execuções</p>
        <div className="pac-date-row"><input aria-label="Data da execução" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="button" disabled={!date || busy} onClick={addDate}>Adicionar data</button></div>
        {dates.length ? <div className="pac-date-chips">{dates.map((item) => <span className="pac-chip" key={item}>{item}<button type="button" aria-label={`Remover ${item}`} onClick={() => setDates((current) => current.filter((value) => value !== item))}>×</button></span>)}</div> : <p className="admin-sub pac-empty">Escolha uma data para criar a execução. Você pode adicionar várias.</p>}
        <button type="button" className="admin-btn primary pac-create-main" disabled={!dates.length || busy} onClick={create}>Criar {dates.length || "execução"}</button>
      </div>}
    </div> : null}
  </div>;
}
