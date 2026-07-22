"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assigneeOptions, formatAssignees, parseAssignees } from "@/lib/assignees";

export default function AssigneePicker({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => parseAssignees(value), [value]);
  const allOptions = useMemo(() => assigneeOptions([...options, value]), [options, value]);
  const available = allOptions.filter((name) => !selected.some((item) => item.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")));

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!open && !editing) return;
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setEditing(false);
        setInput("");
      }
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [editing, open]);

  function add(name: string) {
    const next = formatAssignees([...selected, name]);
    if (next.length <= 120) onChange(next);
    setInput("");
    setEditing(false);
    setOpen(false);
  }

  function commitInput() {
    if (input.trim()) add(input.trim());
    else setEditing(false);
  }

  function remove(name: string) {
    onChange(formatAssignees(selected.filter((item) => item !== name)));
  }

  return (
    <div className="assignee-picker" ref={rootRef} onDoubleClick={() => !disabled && setEditing(true)}>
      <div className="assignee-picker-value">
        {selected.map((name) => (
          <span className="assignee-chip" key={name}>
            {name}
            <button type="button" disabled={disabled} onClick={() => remove(name)} aria-label={`Remover ${name}`}>×</button>
          </span>
        ))}
        {!selected.length && !editing ? <span className="assignee-empty">Sem responsável</span> : null}
        <button
          type="button"
          className="assignee-add"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); setOpen(false); }}
          aria-label="Adicionar responsável"
          title="Clique para escolher ou clique duas vezes para escrever um novo"
        >+</button>
      </div>

      {editing ? (
        <input
          ref={inputRef}
          className="assignee-new-input"
          value={input}
          maxLength={120}
          onChange={(event) => setInput(event.target.value)}
          onBlur={commitInput}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitInput(); }
            if (event.key === "Escape") { setEditing(false); setInput(""); }
          }}
          placeholder="Nome do novo responsável"
        />
      ) : null}

      {open ? (
        <div className="assignee-options" role="listbox" aria-label="Responsáveis disponíveis">
          {available.map((name) => <button type="button" role="option" aria-selected={false} key={name} onClick={() => add(name)}>{name}</button>)}
          <button type="button" className="assignee-create" onClick={() => { setOpen(false); setEditing(true); }}>+ Escrever novo responsável</button>
        </div>
      ) : null}
    </div>
  );
}
