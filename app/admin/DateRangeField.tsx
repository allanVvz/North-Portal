"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Single compact date-range field — reuses CalendarPicker's visual language
// (cal-pop/cal-pop-grid/cal-pop-day classes, same viewport-clamping popover
// positioning) but shows 2 consecutive months side by side instead of one,
// with the 7/30/90-day presets living inside the same dropdown instead of
// as always-visible buttons next to it. Standalone (not a CalendarPicker
// variant) so it can be reused later for Plano de Ação's own range picker
// without carrying CalendarPicker's recurrence/time/single-date concerns.

const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
function toISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function short(value: string): string {
  const date = parse(value);
  return date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

function monthDays(y: number, m: number): Date[] {
  const first = new Date(y, m, 1);
  const gridStart = new Date(y, m, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function MonthGrid({ y, m, from, to, today, onPick }: { y: number; m: number; from: string; to: string; today: Date; onPick: (iso: string) => void }) {
  const days = monthDays(y, m);
  return (
    <div className="cal-pop-dual-month">
      <p className="cal-pop-dual-monthlabel">{MONTHS_FULL[m]} {y}</p>
      <div className="cal-pop-grid">
        {WEEKDAYS.map((weekday, index) => <span className="cal-pop-wd" key={index}>{weekday}</span>)}
        {days.map((date) => {
          const iso = toISO(date);
          const inRange = Boolean(from && to && iso > from && iso < to);
          const classes = [
            "cal-pop-day",
            date.getMonth() !== m ? "out" : "",
            iso === toISO(today) ? "today" : "",
            iso === from ? "range-start" : "",
            iso === to ? "range-end" : "",
            inRange ? "in-range" : "",
          ].filter(Boolean).join(" ");
          return <button type="button" key={iso} className={classes} onClick={() => onPick(iso)}>{date.getDate()}</button>;
        })}
      </div>
    </div>
  );
}

export default function DateRangeField({
  from,
  to,
  onChange,
  presets,
  activePreset,
  onPreset,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  presets: number[];
  activePreset: number | null;
  onPreset: (days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickingEnd, setPickingEnd] = useState(false);
  const today = useState(() => new Date())[0];
  const [view, setView] = useState(() => {
    const base = parse(from) ?? today;
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState({ top: 0, left: 0, visibility: "hidden" as "hidden" | "visible" });

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
    const position = () => {
      const anchor = ref.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const margin = 12;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const left = Math.min(Math.max(anchorRect.left, margin), viewportWidth - popoverRect.width - margin);
      const spaceBelow = viewportHeight - anchorRect.bottom - gap - margin;
      const spaceAbove = anchorRect.top - gap - margin;
      const openAbove = popoverRect.height > spaceBelow && spaceAbove > spaceBelow;
      const top = openAbove
        ? Math.max(margin, anchorRect.top - gap - popoverRect.height)
        : Math.min(anchorRect.bottom + gap, viewportHeight - popoverRect.height - margin);
      setPopoverStyle({ top, left, visibility: "visible" });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    position();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    if (ref.current) observer.observe(ref.current);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [open]);

  function stepMonths(direction: -1 | 1) {
    setView((current) => {
      const date = new Date(current.y, current.m + direction, 1);
      return { y: date.getFullYear(), m: date.getMonth() };
    });
  }

  function pick(iso: string) {
    if (!pickingEnd) {
      onChange(iso, to && to > iso ? to : iso);
      setPickingEnd(true);
    } else {
      if (iso < from) onChange(iso, from);
      else onChange(from, iso);
      setPickingEnd(false);
      setOpen(false);
    }
  }

  const nextView = (() => {
    const date = new Date(view.y, view.m + 1, 1);
    return { y: date.getFullYear(), m: date.getMonth() };
  })();

  return (
    <div className="perf-daterange-field" ref={ref}>
      <button type="button" className="perf-daterange-trigger" onClick={() => { setOpen((v) => !v); setPickingEnd(false); }}>
        <span aria-hidden>◇</span>
        {from && to ? `${short(from)} → ${short(to)}` : "Selecionar período"}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="cal-pop cal-pop-dual" ref={popoverRef} style={popoverStyle}>
          <div className="cal-pop-bar">
            <button type="button" onClick={() => stepMonths(-1)} aria-label="Mês anterior">‹</button>
            <strong>{MONTHS_FULL[view.m]} {view.y} — {MONTHS_FULL[nextView.m]} {nextView.y}</strong>
            <button type="button" onClick={() => stepMonths(1)} aria-label="Próximo mês">›</button>
          </div>
          <div className="cal-pop-dual-grids">
            <MonthGrid y={view.y} m={view.m} from={from} to={to} today={today} onPick={pick} />
            <MonthGrid y={nextView.y} m={nextView.m} from={from} to={to} today={today} onPick={pick} />
          </div>
          <div className="cal-pop-presets">
            {presets.map((days) => (
              <button type="button" key={days} className={activePreset === days ? "on" : ""} onClick={() => { onPreset(days); setOpen(false); }}>
                {days} dias
              </button>
            ))}
          </div>
        </div>,
        document.querySelector(".admin-shell") ?? document.body,
      ) : null}
    </div>
  );
}
