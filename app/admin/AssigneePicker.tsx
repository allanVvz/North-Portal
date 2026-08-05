"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assigneeOptions, formatAssignees, parseAssignees } from "@/lib/assignees";

export type AssigneeAccountOption = { id: string; label: string };

export default function AssigneePicker({
  assignee,
  assigneeProfileIds,
  accountOptions,
  freeTextOptions,
  disabled = false,
  onChange,
}: {
  assignee: string | null;
  assigneeProfileIds: string[];
  // Real accounts (North team) — pickable chips linked via task_assignees.
  accountOptions: AssigneeAccountOption[];
  // Suggestions for the free-text remainder (legacy/freelancer names with no login).
  freeTextOptions: string[];
  disabled?: boolean;
  onChange: (next: { assignee: string | null; assigneeProfileIds: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const freeNames = useMemo(() => parseAssignees(assignee), [assignee]);
  const linkedChips = useMemo(
    () => assigneeProfileIds.map((id) => accountOptions.find((a) => a.id === id)).filter((a): a is AssigneeAccountOption => Boolean(a)),
    [assigneeProfileIds, accountOptions],
  );
  const availableAccounts = accountOptions.filter((a) => !assigneeProfileIds.includes(a.id));
  const accountLabelsLower = useMemo(() => new Set(accountOptions.map((a) => a.label.toLocaleLowerCase("pt-BR"))), [accountOptions]);
  const availableFreeText = assigneeOptions(freeTextOptions)
    .filter((name) => !accountLabelsLower.has(name.toLocaleLowerCase("pt-BR")))
    .filter((name) => !freeNames.some((item) => item.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")));

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

  function addAccount(id: string) {
    onChange({ assignee, assigneeProfileIds: [...assigneeProfileIds, id] });
    setOpen(false);
  }

  function addFreeText(name: string) {
    const next = formatAssignees([...freeNames, name]);
    if (next.length <= 120) onChange({ assignee: next || null, assigneeProfileIds });
    setInput("");
    setEditing(false);
    setOpen(false);
  }

  function commitInput() {
    if (input.trim()) addFreeText(input.trim());
    else setEditing(false);
  }

  function removeAccount(id: string) {
    onChange({ assignee, assigneeProfileIds: assigneeProfileIds.filter((item) => item !== id) });
  }

  function removeFreeText(name: string) {
    const next = formatAssignees(freeNames.filter((item) => item !== name));
    onChange({ assignee: next || null, assigneeProfileIds });
  }

  const hasAny = linkedChips.length > 0 || freeNames.length > 0;

  return (
    <div className="assignee-picker" ref={rootRef} onDoubleClick={() => !disabled && setEditing(true)}>
      <div className="assignee-picker-value">
        {linkedChips.map((account) => (
          <span className="assignee-chip assignee-chip-linked" key={account.id} title="Conta vinculada">
            {account.label}
            <button type="button" disabled={disabled} onClick={() => removeAccount(account.id)} aria-label={`Remover ${account.label}`}>×</button>
          </span>
        ))}
        {freeNames.map((name) => (
          <span className="assignee-chip" key={name}>
            {name}
            <button type="button" disabled={disabled} onClick={() => removeFreeText(name)} aria-label={`Remover ${name}`}>×</button>
          </span>
        ))}
        {!hasAny && !editing ? <span className="assignee-empty">Sem responsável</span> : null}
        <button
          type="button"
          className="assignee-add"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); setOpen(false); }}
          aria-label="Adicionar responsável"
          title="Clique para escolher uma conta ou clique duas vezes para escrever um nome sem conta"
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
          placeholder="Nome do responsável sem conta"
        />
      ) : null}

      {open ? (
        <div className="assignee-options" role="listbox" aria-label="Responsáveis disponíveis">
          {availableAccounts.map((account) => (
            <button type="button" role="option" aria-selected={false} key={account.id} onClick={() => addAccount(account.id)}>
              {account.label}
            </button>
          ))}
          {availableFreeText.length ? (
            <>
              <div className="assignee-options-divider">Nomes sem conta</div>
              {availableFreeText.map((name) => (
                <button type="button" role="option" aria-selected={false} key={name} onClick={() => addFreeText(name)}>{name}</button>
              ))}
            </>
          ) : null}
          <button type="button" className="assignee-create" onClick={() => { setOpen(false); setEditing(true); }}>+ Escrever novo responsável</button>
        </div>
      ) : null}
    </div>
  );
}
