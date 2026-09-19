"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import { normalizeSearchText } from "@/lib/taskSearch";

type Candidate = { id: string; title: string; kind: string; due_date?: string | null };

export default function RecurrenceExecutionCombobox({ candidates, templateKind, busy, onLink, onCreate }: {
  candidates: Candidate[]; templateKind: string; busy: boolean;
  onLink: (candidate: Candidate, date: string) => void;
  onCreate: (dates: string[], title: string) => void;
}) {
  const [query, setQuery] = useState(""); const [date, setDate] = useState(""); const [dates, setDates] = useState<string[]>([]); const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null); const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!open) return; const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; document.addEventListener("mousedown", down); document.addEventListener("keydown", key); return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); }; }, [open]);
  const needle = normalizeSearchText(query.trim());
  const matches = useMemo(() => (needle ? candidates.filter((c) => normalizeSearchText(c.title).includes(needle)) : candidates).slice().sort((a, b) => Number(b.kind === templateKind) - Number(a.kind === templateKind)).slice(0, 6), [candidates, needle, templateKind]);
  function addDate() { if (!date || dates.includes(date)) return; setDates((current) => [...current, date].sort()); setDate(""); }
  function create() { if (!dates.length || busy) return; onCreate(dates, query.trim()); setDates([]); setQuery(""); setDate(""); }
  return <div className={`pac${open ? " is-open" : ""}`} ref={ref}><div className="pac-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}><span className="pac-plus" aria-hidden>+</span>{dates.map((item) => <span className="pac-chip" key={item}>{item}<button type="button" aria-label={`Remover ${item}`} onClick={(e) => { e.stopPropagation(); setDates((current) => current.filter((d) => d !== item)); }}>×</button></span>)}<input ref={inputRef} className="pac-input" role="combobox" aria-expanded={open} aria-label="Adicionar execução da recorrência" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Buscar ou criar execução…" />{dates.length ? <button type="button" className="admin-btn primary pac-create" disabled={busy} onClick={(e) => { e.stopPropagation(); create(); }}>Criar {dates.length}</button> : null}</div>{open ? <div className="pac-panel">{matches.length ? <div className="pac-section"><p className="pac-section-title">Vincular existente</p>{matches.map((candidate) => <div className="pac-row" key={candidate.id}><TaskKindIcon kind={candidate.kind} size="sm" /><span className="pac-row-label">{candidate.title}</span><input aria-label={`Data de ${candidate.title}`} type="date" defaultValue={candidate.due_date ?? ""} /><button type="button" className="pac-link" disabled={busy} onClick={(e) => { const input = e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null; onLink(candidate, input?.value || candidate.due_date || new Date().toISOString().slice(0, 10)); setOpen(false); }}>vincular</button></div>)}</div> : null}<div className="pac-section"><p className="pac-section-title">Criar execução<span>mesmo tipo: {templateKind}</span></p><div className="pac-row"><input aria-label="Data da execução" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><button type="button" className="pac-link" disabled={!date || busy} onClick={addDate}>Adicionar data</button></div><div className="pac-foot">{dates.length ? `${dates.length} data(s) selecionada(s). Digite um título opcional e clique em Criar.` : "Escolha uma ou várias datas, passadas ou futuras."}</div></div></div> : null}</div>;
}
