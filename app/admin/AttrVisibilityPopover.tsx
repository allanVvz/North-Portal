"use client";

import { useEffect, useRef, useState } from "react";
import { KIND_ICON, isAttrVisible, useAttrVisibility, type AttrDef } from "./kanbanAttrs";

// Small gear-icon popover (replaces the old full-width "⚙ Atributos visíveis"
// button + inline expanding list inside TaskModal) — same underlying
// ATTR_DEFS/useAttrVisibility data, just a lighter-weight surface.
export default function AttrVisibilityPopover({ attrs }: { attrs: AttrDef[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { map, save } = useAttrVisibility({ lazy: true });

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

  function toggle(key: string) {
    save({ ...map, [key]: !isAttrVisible(map, key) });
  }

  return (
    <div className="attrvis" ref={ref}>
      <button
        type="button"
        className="attrvis-gear"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Atributos visíveis"
        title="Atributos visíveis"
      >
        ⚙
      </button>
      {open ? (
        <div className="attrvis-popover" role="menu">
          <p className="attrvis-head">Atributos visíveis</p>
          {attrs.map((a) => (
            <label className="attrvis-row" key={a.key} title={a.locked ? "Sempre visível" : undefined}>
              <span className="attrvis-ico" aria-hidden>{KIND_ICON[a.kind]}</span>
              <span className="attrvis-label">{a.label}</span>
              <span className="admin-toggle attrvis-toggle">
                <input type="checkbox" checked={isAttrVisible(map, a.key)} disabled={a.locked} onChange={() => toggle(a.key)} />
                <span className="sw" />
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
