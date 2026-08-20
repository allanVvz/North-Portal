"use client";

import { useEffect, useRef, useState } from "react";
import type { MetricRef } from "@/lib/performancePrefs";

type MetricOption = { ref: MetricRef; label: string };

export default function MetricSettingsMenu({
  label,
  options,
  selected,
  multiple = false,
  max = 1,
  onChange,
}: {
  label: string;
  options: MetricOption[];
  selected: MetricRef[];
  multiple?: boolean;
  max?: number;
  onChange: (metric: MetricRef) => void;
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
    <div className="perf-chart-settings" ref={rootRef}>
      <button type="button" className="perf-settings-trigger" aria-label={`Configurar ${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden>⚙</span><span>Configurar</span>
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
  );
}
