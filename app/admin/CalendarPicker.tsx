"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
export type CalendarRecurrence = { cadence: "semanal" | "quinzenal" | "mensal" | null; weekdays: number[]; dayOfMonth: number | null };

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
function toISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function typedLabel(value: string): string {
  const date = parse(value);
  return date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}` : "";
}
function parseTyped(text: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : new Date().getFullYear();
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

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
  nextExecutionValue,
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
  nextExecutionValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState<"start" | "end">("start");
  const today = useState(() => new Date())[0];
  const selected = parse(value);
  const [view, setView] = useState(() => {
    const base = selected ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const [text, setText] = useState(() => typedLabel(value));
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState({
    top: 0,
    left: 0,
    width: 390,
    maxHeight: 10_000,
    visibility: "hidden" as "hidden" | "visible",
  });
  useEffect(() => setText(typedLabel(value)), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;

    let frame = 0;
    const positionPopover = () => {
      const anchor = ref.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const scale = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const margin = 12;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const visualWidth = Math.min(popoverRect.width, viewportWidth - margin * 2);
      const visualHeight = Math.min(popoverRect.height, viewportHeight - margin * 2);

      const left = Math.min(
        Math.max(anchorRect.right - visualWidth, margin),
        viewportWidth - visualWidth - margin,
      );
      const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin;
      const spaceAbove = anchorRect.top - gap - margin;
      const openAbove = visualHeight > spaceBelow && spaceAbove > spaceBelow;
      const top = openAbove
        ? Math.max(margin, anchorRect.top - gap - visualHeight)
        : Math.min(anchorRect.bottom + gap, viewportHeight - visualHeight - margin);

      setPopoverStyle({
        top: top / scale,
        left: left / scale,
        width: Math.min(390, (viewportWidth - margin * 2) / scale),
        maxHeight: (viewportHeight - margin * 2) / scale,
        visibility: "visible",
      });
    };
    const schedulePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(positionPopover);
    };

    positionPopover();
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    const observer = new ResizeObserver(schedulePosition);
    if (ref.current) observer.observe(ref.current);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
    };
  }, [open]);

  // Só a data de início é obrigatória. Sem dia-da-semana marcado a recorrência
  // fica no mesmo dia da semana em que começa — é um atalho, não um erro.
  const recurrenceError = recurrence?.cadence && !value ? "Escolha a data de início da recorrência." : "";
  const recurrenceHint = recurrence?.cadence && !recurrence.weekdays.length && value
    ? "Sem dia marcado: recorre no mesmo dia da semana da data de início."
    : "";

  function commitTyped() {
    const next = text.trim();
    if (!next) { onChange(""); return; }
    const parsed = parseTyped(next);
    if (parsed) onChange(toISO(parsed)); else setText(typedLabel(value));
  }
  function chooseDate(iso: string) {
    if (onEndChange && endpoint === "end") {
      onEndChange(iso < value ? value : iso);
      return;
    }
    onChange(iso);
    if (onEndChange) {
      if (!endValue || endValue < iso) onEndChange(iso);
      setEndpoint("end");
    } else if (!onRecurrenceChange) setOpen(false);
  }
  function setRecurring(enabled: boolean) {
    if (!recurrence || !onRecurrenceChange) return;
    if (!enabled && recurrenceRequired) return;
    const startDay = parse(value)?.getDay() ?? today.getDay();
    onRecurrenceChange(enabled
      ? { cadence: recurrence.cadence ?? "semanal", weekdays: recurrence.weekdays.length ? recurrence.weekdays : [startDay], dayOfMonth: parse(value)?.getDate() ?? today.getDate() }
      : { cadence: null, weekdays: [], dayOfMonth: null });
  }
  function stepMonth(direction: -1 | 1) {
    setView((current) => {
      const date = new Date(current.y, current.m + direction, 1);
      return { y: date.getFullYear(), m: date.getMonth() };
    });
  }

  const first = new Date(view.y, view.m, 1);
  const gridStart = new Date(view.y, view.m, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  return (
    <div className="cal-pick" ref={ref}>
      <div className="cal-pick-trigger">
        <button type="button" className="cal-pick-ico" aria-label="Abrir calendário" onClick={() => { setOpen((current) => !current); setEndpoint("start"); }}>◇</button>
        <input className="cal-pick-input" value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} onBlur={commitTyped} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commitTyped(); }
          if (event.key === "Escape") setText(typedLabel(value));
        }} />
      </div>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="cal-pop cal-pop-range" ref={popoverRef} style={popoverStyle}>
          <div className="cal-pop-bar">
            <button type="button" onClick={() => stepMonth(-1)} aria-label="Mês anterior">‹</button>
            <strong>{MONTHS_FULL[view.m]} {view.y}</strong>
            <button type="button" onClick={() => stepMonth(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="cal-pop-grid">
            {WEEKDAYS.map((weekday, index) => <span className="cal-pop-wd" key={index}>{weekday}</span>)}
            {days.map((date) => {
              const iso = toISO(date);
              const inRange = Boolean(value && endValue && iso > value && iso < endValue);
              const classes = [
                "cal-pop-day",
                date.getMonth() !== view.m ? "out" : "",
                iso === toISO(today) ? "today" : "",
                iso === value ? "range-start" : "",
                iso === endValue ? "range-end" : "",
                inRange ? "in-range" : "",
                iso === nextExecutionValue ? "next-execution" : "",
              ].filter(Boolean).join(" ");
              return <button type="button" key={iso} className={classes} onClick={() => chooseDate(iso)} aria-label={iso === nextExecutionValue ? `${typedLabel(iso)}, próxima execução` : typedLabel(iso)}>{date.getDate()}</button>;
            })}
          </div>

          {onEndChange ? (
            <div className="cal-range-summary" aria-label="Intervalo selecionado">
              <button type="button" className={endpoint === "start" ? "on" : ""} onClick={() => setEndpoint("start")}><small>Início</small><strong>{typedLabel(value) || "Escolher"}</strong></button>
              <span>→</span>
              <button type="button" className={endpoint === "end" ? "on" : ""} onClick={() => setEndpoint("end")}><small>Fim</small><strong>{typedLabel(endValue ?? "") || "Escolher"}</strong></button>
            </div>
          ) : null}

          {recurrenceFeatureEnabled && recurrence && onRecurrenceChange ? (
            <div className="cal-recurrence">
              <label className="cal-rec-toggle"><span>Recorrente</span><input type="checkbox" checked={Boolean(recurrence.cadence)} onChange={(event) => setRecurring(event.target.checked)} /></label>
              {recurrence.cadence ? (
                <>
                  <label>Frequência<select value={recurrence.cadence} onChange={(event) => onRecurrenceChange({ ...recurrence, cadence: event.target.value as NonNullable<CalendarRecurrence["cadence"]> })}>
                    <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
                  </select></label>
                  <div className="cal-recurrence-days" aria-label="Dias da semana">
                    {WEEKDAYS.map((label, day) => <button type="button" aria-pressed={recurrence.weekdays.includes(day)} className={recurrence.weekdays.includes(day) ? "on" : ""} key={day} onClick={() => onRecurrenceChange({ ...recurrence, weekdays: recurrence.weekdays.includes(day) ? recurrence.weekdays.filter((item) => item !== day) : [...recurrence.weekdays, day] })}>{label}</button>)}
                  </div>
                  {recurrence.cadence === "mensal" ? <p className="cal-recurrence-anchor">A data inicial ancora cada mês; será usado o dia marcado mais próximo.</p> : null}
                  {recurrenceHint ? <p className="cal-recurrence-anchor">{recurrenceHint}</p> : null}
                </>
              ) : null}
              {recurrenceError ? <p className="cal-local-error" role="alert">{recurrenceError}</p> : null}
            </div>
          ) : null}

          {onTimeChange ? <div className="cal-schedule cal-time-last"><label>Horário <small>opcional</small><input type="time" value={timeValue ?? ""} onChange={(event) => onTimeChange(event.target.value)} /></label></div> : null}
          {value ? <button type="button" className="cal-pop-clear" onClick={() => { onChange(""); onEndChange?.(""); }}>Limpar intervalo</button> : null}
        </div>,
        document.querySelector(".admin-shell") ?? document.body,
      ) : null}
    </div>
  );
}
