"use client";

import { useState } from "react";

// Campo de tags/etiquetas — digita e Enter (ou vírgula) vira chip removível.
// Mesmo visual das chips de filtro da barra de tarefas (`.kb-filterchip`).
// Genérico: as `suggestions` só facilitam, qualquer texto vira tag.
export default function TagChipsInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Adicionar…",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: { key: string; label: string }[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || value.includes(tag)) { setDraft(""); return; }
    onChange([...value, tag]);
    setDraft("");
  }
  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  const unused = suggestions.filter((s) => !value.includes(s.key));

  return (
    <div className="tagchips">
      <div className="tagchips-box">
        {value.map((tag) => {
          const known = suggestions.find((s) => s.key === tag);
          return (
            <span className="kb-filterchip" key={tag}>
              {known?.label ?? tag}
              <button type="button" aria-label={`Remover ${tag}`} onClick={() => remove(tag)}>✕</button>
            </span>
          );
        })}
        <input
          className="tagchips-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            if (e.key === "Backspace" && !draft && value.length) remove(value[value.length - 1]);
          }}
          placeholder={value.length ? "" : placeholder}
        />
      </div>
      {unused.length ? (
        <div className="tagchips-suggest">
          {unused.map((s) => (
            <button type="button" key={s.key} className="kb-chip" onClick={() => add(s.key)}>+ {s.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
