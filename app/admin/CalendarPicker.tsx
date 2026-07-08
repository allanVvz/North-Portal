"use client";

import { useEffect, useRef, useState } from "react";

const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MONTHS_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function parse(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtLabel(value: string, mode: "day" | "month"): string {
  const d = parse(value);
  if (!d) return "";
  if (mode === "month") return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** A compact date field: click to open a month-grid popover, click a day to set it. */
export default function CalendarPicker({
  value,
  onChange,
  placeholder = "Selecionar data",
  mode = "day",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** "month" shows only "Junho 2026" in the trigger (e.g. for períodos) while still picking a day internally. */
  mode?: "day" | "month";
}) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const today = useState(() => new Date())[0];
  const [view, setView] = useState(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
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

  function openPicker() {
    const base = selected ?? today;
    setView({ y: base.getFullYear(), m: base.getMonth() });
    setOpen((o) => !o);
  }
  function stepMonth(dir: -1 | 1) {
    setView((v) => {
      const d = new Date(v.y, v.m + dir, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }
  const first = new Date(view.y, view.m, 1);
  const start = new Date(view.y, view.m, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="cal-pick" ref={ref}>
      <button type="button" className="cal-pick-trigger" onClick={openPicker}>
        <span className="cal-pick-ico" aria-hidden>▦</span>
        <span className={value ? "" : "cal-pick-placeholder"}>{value ? fmtLabel(value, mode) : placeholder}</span>
      </button>
      {open ? (
        <div className="cal-pop">
          <div className="cal-pop-bar">
            <button type="button" onClick={() => stepMonth(-1)} aria-label="Mês anterior">‹</button>
            <strong>{MONTHS_FULL[view.m]} {view.y}</strong>
            <button type="button" onClick={() => stepMonth(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="cal-pop-grid">
            {WEEKDAYS.map((w, i) => <span className="cal-pop-wd" key={i}>{w}</span>)}
            {days.map((d) => {
              const outside = d.getMonth() !== view.m;
              const isToday = dayKey(d) === dayKey(today);
              const isSelected = selected ? dayKey(d) === dayKey(selected) : false;
              return (
                <button
                  type="button"
                  key={d.toISOString()}
                  className={`cal-pop-day${outside ? " out" : ""}${isToday ? " today" : ""}${isSelected ? " sel" : ""}`}
                  onClick={() => { onChange(toISO(d)); setOpen(false); }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          {value ? (
            <button type="button" className="cal-pop-clear" onClick={() => { onChange(""); setOpen(false); }}>
              Limpar data
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
