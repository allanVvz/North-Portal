"use client";

import { useEffect, useRef, useState } from "react";

const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
export type CalendarRecurrence = { cadence: "semanal" | "quinzenal" | "mensal" | null; weekdays: number[]; dayOfMonth: number | null };

function parse(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Typed-input format: DD/MM/AAAA — what someone would naturally type, not the
// "5 jul 2026" read-only label.
function typedLabel(value: string): string {
  const d = parse(value);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
// Accepts DD/MM/AAAA, DD/MM/AA (assumes 20xx) and DD/MM (assumes current
// year) — forgiving of whatever a person actually types.
function parseTyped(text: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Rejects overflow like 31/02 silently rolling into March.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** A compact date field: type DD/MM/AAAA directly, or click the ▦ icon to open a month-grid popover. */
export default function CalendarPicker({
  value,
  onChange,
  placeholder = "Selecionar data",
  endValue,
  onEndChange,
  timeValue,
  onTimeChange,
  recurrence,
  onRecurrenceChange,
  recurrenceFeatureEnabled = true,
  recurrenceRequired = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  endValue?: string;
  onEndChange?: (value: string) => void;
  timeValue?: string;
  onTimeChange?: (value: string) => void;
  recurrence?: CalendarRecurrence;
  onRecurrenceChange?: (value: CalendarRecurrence) => void;
  recurrenceFeatureEnabled?: boolean;
  recurrenceRequired?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const today = useState(() => new Date())[0];
  const [view, setView] = useState(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const ref = useRef<HTMLDivElement>(null);
  // Free-typed text buffer — separate from `value` so a mid-typo keystroke
  // never has to be a valid date. Re-synced from `value` whenever it changes
  // from outside (grid click, "Limpar data", or our own commit below).
  const [text, setText] = useState(() => typedLabel(value));
  useEffect(() => setText(typedLabel(value)), [value]);

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
  // Commit whatever's typed: a valid date updates the real value (which then
  // re-syncs `text` to its canonical DD/MM/AAAA form); empty clears it;
  // anything else (still mid-typo) just reverts the buffer, the real value
  // is untouched.
  function commitTyped() {
    const t = text.trim();
    if (!t) { if (value) onChange(""); return; }
    const parsed = parseTyped(t);
    if (parsed) onChange(toISO(parsed));
    else setText(typedLabel(value));
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
      <div className="cal-pick-trigger">
        <button type="button" className="cal-pick-ico" aria-label="Abrir calendário" onClick={openPicker}>▦</button>
        <input
          className="cal-pick-input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitTyped(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") setText(typedLabel(value));
          }}
        />
      </div>
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
          {(onEndChange || onTimeChange) ? (
            <div className="cal-schedule">
              <label>Início<input type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>
              {onEndChange ? <label>Fim <small>opcional</small><input type="date" min={value || undefined} value={endValue ?? ""} onChange={(event) => onEndChange(event.target.value)} /></label> : null}
              {onTimeChange ? <label>Horário <small>opcional</small><input type="time" value={timeValue ?? ""} onChange={(event) => onTimeChange(event.target.value)} /></label> : null}
            </div>
          ) : null}
          {recurrenceFeatureEnabled && recurrence && onRecurrenceChange ? (
            <div className="cal-recurrence">
              <label>Repetir
                <select value={recurrence.cadence ?? ""} onChange={(event) => {
                  const cadence = (event.target.value || null) as CalendarRecurrence["cadence"];
                  onRecurrenceChange({ cadence, weekdays: cadence === "semanal" ? recurrence.weekdays : [], dayOfMonth: cadence === "mensal" ? (recurrence.dayOfMonth ?? selected?.getDate() ?? 1) : null });
                }}>
                  {!recurrenceRequired ? <option value="">Nenhuma</option> : null}<option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
                </select>
              </label>
              {recurrence.cadence === "semanal" ? <div className="cal-recurrence-days">{WEEKDAYS.map((label, day) => <button type="button" className={recurrence.weekdays.includes(day) ? "on" : ""} key={day} onClick={() => onRecurrenceChange({ ...recurrence, weekdays: recurrence.weekdays.includes(day) ? recurrence.weekdays.filter((item) => item !== day) : [...recurrence.weekdays, day] })}>{label}</button>)}</div> : null}
              {recurrence.cadence === "mensal" ? <label>Dia do mês<input type="number" min={1} max={31} value={recurrence.dayOfMonth ?? 1} onChange={(event) => onRecurrenceChange({ ...recurrence, dayOfMonth: Math.max(1, Math.min(31, Number(event.target.value) || 1)) })} /></label> : null}
            </div>
          ) : null}
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
