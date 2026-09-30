"use client";

import { useEffect, useRef, useState } from "react";

// Small inline dropdown used in the edit-mode header for Cliente and Tipo —
// click the pill, pick from the list, it closes itself (the click on an
// option bubbles up to the panel's own onClick).
export default function HeadDropdown({
  trigger,
  children,
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
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

  return (
    <div className={`tm-headpick ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        className="tm-headpick-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {trigger}
        <span className={`tm-headpick-caret ${open ? "on" : ""}`} aria-hidden>⌄</span>
      </button>
      {open ? (
        <div className="tm-headpick-panel" role="listbox" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
