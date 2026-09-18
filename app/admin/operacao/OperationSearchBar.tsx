"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MULTI_VALUE_ATTRS, type OperationFilter, type OperationFilterAttr } from "./operationItems";

// Uma caixa só: os filtros ativos moram DENTRO dela, como bolhas, antes do
// texto livre — o mesmo desenho do KanbanSearchBar que esta tela tinha antes
// de 7606ad6. Não existe botão "Filtros": clicar ou focar a caixa abre o painel.
//
// Atributos de vários valores (Status, Tipo) viram UMA bolha agregada
// ("Status: Entrada +4") — cinco bolhas de status lado a lado lotavam a caixa
// antes de a pessoa digitar qualquer coisa. Clicar na bolha abre os valores
// daquele atributo no próprio painel, marcados, para tirar ou pôr um a um.

export type AttrDef = { key: OperationFilterAttr; label: string; icon: string };
export type AttrOption = { value: string; label: string };

type PanelState = { mode: "attrs" } | { mode: "values"; attr: OperationFilterAttr };

export default function OperationSearchBar({
  q,
  onQChange,
  placeholder,
  filters,
  attrs,
  optionsFor,
  onToggle,
  onRemoveAttr,
  onRemoveLast,
  onReset,
  isDefault,
}: {
  q: string;
  onQChange: (value: string) => void;
  placeholder: string;
  filters: OperationFilter[];
  /** Atributos oferecidos agora (Subtipo só aparece depois de um Tipo). */
  attrs: AttrDef[];
  optionsFor: (attr: OperationFilterAttr) => AttrOption[];
  /** Liga/desliga um valor. Em atributo de valor único, trocar = ligar outro. */
  onToggle: (attr: OperationFilterAttr, option: AttrOption) => void;
  onRemoveAttr: (attr: OperationFilterAttr) => void;
  onRemoveLast: () => void;
  onReset: () => void;
  isDefault: boolean;
}) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!panel) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPanel(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setPanel(null); inputRef.current?.blur(); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  const labelOf = useMemo(() => new Map(attrs.map((attr) => [attr.key, attr.label])), [attrs]);

  // Uma bolha por atributo, na ordem em que o atributo apareceu.
  const groups = useMemo(() => {
    const map = new Map<OperationFilterAttr, OperationFilter[]>();
    for (const filter of filters) map.set(filter.attr, [...(map.get(filter.attr) ?? []), filter]);
    return [...map.entries()];
  }, [filters]);

  const valuesAttr = panel?.mode === "values" ? panel.attr : null;
  const options = valuesAttr ? optionsFor(valuesAttr) : [];
  const selected = new Set(filters.filter((filter) => filter.attr === valuesAttr).map((filter) => filter.value));
  const multi = valuesAttr ? MULTI_VALUE_ATTRS.includes(valuesAttr) : false;

  function openAttrs() { setPanel({ mode: "attrs" }); }

  return (
    <div className="kb-searchbar op-searchbar" ref={rootRef}>
      <div className="kb-searchbar-box" onClick={() => { if (!panel) openAttrs(); inputRef.current?.focus(); }}>
        <span className="op-searchbar-icon" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 16 16" focusable="false"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m10.6 10.6 3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
        {groups.map(([attr, values]) => (
          <span className={`kb-filterchip op-chip${valuesAttr === attr ? " on" : ""}`} key={attr}>
            <button
              type="button"
              className="op-chip-open"
              aria-expanded={valuesAttr === attr}
              aria-controls={panelId}
              title={values.map((value) => value.label).join(", ")}
              onClick={(event) => { event.stopPropagation(); setPanel(valuesAttr === attr ? null : { mode: "values", attr }); }}
            >
              <b>{labelOf.get(attr) ?? attr}:</b> {values[0].label}
              {values.length > 1 ? <span className="op-chip-more">+{values.length - 1}</span> : null}
            </button>
            <button
              type="button"
              className="op-chip-remove"
              aria-label={`Remover filtro ${labelOf.get(attr) ?? attr}`}
              onClick={(event) => { event.stopPropagation(); onRemoveAttr(attr); if (valuesAttr === attr) setPanel(null); }}
            >✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="kb-searchbar-input"
          value={q}
          onChange={(event) => { onQChange(event.target.value); }}
          onFocus={() => { if (!panel) openAttrs(); }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !q && filters.length) { event.preventDefault(); onRemoveLast(); }
          }}
          placeholder={placeholder}
          aria-label="Buscar ou filtrar"
          aria-expanded={Boolean(panel)}
          aria-controls={panelId}
        />
        {q ? (
          <button type="button" className="op-searchbar-clear" aria-label="Limpar busca" onClick={(event) => { event.stopPropagation(); onQChange(""); inputRef.current?.focus(); }}>✕</button>
        ) : null}
      </div>
      {panel ? (
        <div className="kb-searchbar-panel op-searchbar-panel" id={panelId}>
          {valuesAttr ? (
            <>
              <div className="kb-searchbar-panelhead">
                <button type="button" className="kb-searchbar-back" onClick={() => setPanel({ mode: "attrs" })}>‹ Atributos</button>
                <span>{labelOf.get(valuesAttr) ?? valuesAttr}{multi ? <small> · vários ao mesmo tempo</small> : null}</span>
              </div>
              <div className="kb-searchbar-chips">
                {options.map((option) => {
                  const on = selected.has(option.value);
                  return (
                    <button
                      type="button"
                      key={option.value}
                      className={`kb-chip op-option${on ? " on" : ""}`}
                      aria-pressed={on}
                      onClick={() => { onToggle(valuesAttr, option); if (!multi) setPanel(null); }}
                    >
                      {multi ? <span className="op-option-check" aria-hidden>{on ? "✓" : ""}</span> : null}
                      {option.label}
                    </button>
                  );
                })}
                {options.length === 0 ? <p className="admin-sub kb-searchbar-empty">Nenhum valor disponível.</p> : null}
              </div>
            </>
          ) : (
            <>
              <div className="kb-searchbar-panelhead"><span>Filtrar por atributo</span></div>
              <div className="kb-searchbar-attrlist">
                {attrs.map((attr) => {
                  const count = filters.filter((filter) => filter.attr === attr.key).length;
                  return (
                    <button type="button" key={attr.key} className={`kb-searchbar-attr${count ? " on" : ""}`} onClick={() => setPanel({ mode: "values", attr: attr.key })}>
                      <span aria-hidden>{attr.icon}</span>{attr.label}
                      {count ? <span className="op-attr-count">{count}</span> : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {!isDefault || filters.length ? (
            <div className="op-searchbar-foot">
              {filters.length ? <span>{filters.length} {filters.length === 1 ? "filtro ativo" : "filtros ativos"}</span> : <span>Sem filtros</span>}
              {!isDefault ? <button type="button" className="op-searchbar-reset" onClick={() => { onReset(); setPanel(null); }}>Restaurar padrão</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
