"use client";

import { useEffect, useRef, useState } from "react";
import type { MetricRef } from "@/lib/performancePrefs";

type MetricOption = { ref: MetricRef; label: string };

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0-.1 1 7.6 7.6 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z" />
    </svg>
  );
}

// Ícone-só (sem texto "Configurar") — a engrenagem já comunica a função;
// opcionalmente acompanhado do botão "Hide" do card ao lado (onHideSection).
export default function MetricSettingsMenu({
  label,
  options,
  selected,
  multiple = false,
  max = 1,
  onChange,
  onHideSection,
}: {
  label: string;
  options: MetricOption[];
  selected: MetricRef[];
  multiple?: boolean;
  max?: number;
  onChange: (metric: MetricRef) => void;
  onHideSection?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="perf-card-controls">
      <div className="perf-chart-settings" ref={rootRef}>
        <button type="button" className="perf-settings-trigger icon-only" aria-label={`Configurar ${label}`} title={`Configurar ${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <GearIcon />
        </button>
        {open ? (
          <div className="perf-chart-settings-menu">
            <div className="perf-settings-menu-head"><strong>{label}</strong><small>{multiple ? `Escolha até ${max}` : "Escolha uma métrica"}</small></div>
            <div className="perf-settings-options">
              {options.map((option) => {
                const checked = selected.includes(option.ref);
                return (
                  <label key={option.ref} className={checked ? "on" : ""}>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={multiple ? undefined : `metric-${label}`}
                      checked={checked}
                      disabled={multiple && !checked && selected.length >= max}
                      onChange={() => { onChange(option.ref); if (!multiple) setOpen(false); }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      {onHideSection ? (
        <button type="button" className="perf-settings-trigger icon-only perf-section-hide" aria-label={`Esconder ${label}`} title={`Esconder ${label}`} onClick={onHideSection}>
          <svg viewBox="0 0 24 24" aria-hidden focusable="false"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.6 6.7C4.5 8.1 3 10 2 12c1.8 3.6 5.5 7 10 7 1.7 0 3.3-.4 4.7-1.1M9.9 5.2A10.6 10.6 0 0 1 12 5c4.5 0 8.2 3.4 10 7-.6 1.2-1.4 2.4-2.4 3.4" /></svg>
        </button>
      ) : null}
    </div>
  );
}
