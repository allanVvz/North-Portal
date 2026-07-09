"use client";

import { useState } from "react";
import { ATTR_DEFS, KIND_ICON, isAttrVisible } from "./kanbanAttrs";

export default function AttributesConfigModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Record<string, boolean>;
  onClose: () => void;
  onSave: (map: Record<string, boolean>) => void;
}) {
  const [map, setMap] = useState<Record<string, boolean>>(initial);

  function toggle(key: string) {
    setMap((m) => ({ ...m, [key]: !isAttrVisible(m, key) }));
  }
  function isOn(key: string) {
    return isAttrVisible(map, key);
  }

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="attrcfg" onClick={(e) => e.stopPropagation()}>
        <div className="attrcfg-head">
          <div>
            <h2>Configurar atributos</h2>
            <p className="admin-sub">Defina os tipos e a visibilidade de cada propriedade</p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="attrcfg-list">
          {ATTR_DEFS.map((a) => (
            <div className="attrcfg-row" key={a.key}>
              <span className="attrcfg-handle" aria-hidden title="Ordem fixa">⋮⋮</span>
              <span className="attrcfg-ico" aria-hidden>{KIND_ICON[a.kind]}</span>
              <span className="attrcfg-meta">
                <strong>{a.label}</strong>
                <small>{a.scope}</small>
              </span>
              <span className="attrcfg-kind">{a.kind}</span>
              <span className={`attrcfg-scopetag ${a.kinds === "base" ? "base" : "tipo"}`}>
                {a.kinds === "base" ? "base" : "tipo"}
              </span>
              <label className="admin-toggle attrcfg-toggle" title={a.locked ? "Sempre visível" : undefined}>
                <input
                  type="checkbox"
                  checked={isOn(a.key)}
                  disabled={a.locked}
                  onChange={() => toggle(a.key)}
                />
                <span className="sw" />
              </label>
            </div>
          ))}
        </div>

        <div className="kb-modal-actions">
          <span />
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose}>Cancelar</button>
            <button className="admin-btn primary" onClick={() => onSave(map)}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
