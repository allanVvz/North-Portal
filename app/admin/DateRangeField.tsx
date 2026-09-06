"use client";

import { useState } from "react";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";
import {
  MONTHS_FULL,
  WEEKDAYS,
  formatShortDayMonth,
  monthGridDays,
  nextMonth,
  parseIsoDate,
  rangeDayClasses,
  stepMonth,
  toIsoDate,
} from "./calendarGrid";

// Campo compacto de intervalo: uma caixa, DOIS meses lado a lado, mais os
// presets (7/30/90 dias) dentro do próprio dropdown em vez de botões sempre
// visíveis ao lado.
//
// É irmão de CalendarPicker, não uma variante dele: aqui não existe data única,
// horário nem recorrência, e o intervalo é sempre obrigatório. O que os dois
// compartilham — a aritmética da grade (calendarGrid.ts) e a mecânica de
// popover flutuante (FloatingPopover.tsx) — mora fora dos dois.
//
// Nasceu na tela de Performance e por isso as classes eram `.perf-daterange-*`;
// o prefixo saiu quando o componente virou peça comum (roadmap R6.5), para a
// próxima tela não herdar o namespace de Performance junto com o campo.

function MonthGrid({
  year,
  month,
  from,
  to,
  todayIso,
  onPick,
}: {
  year: number;
  month: number;
  from: string;
  to: string;
  todayIso: string;
  onPick: (iso: string) => void;
}) {
  return (
    <div className="cal-pop-dual-month">
      <p className="cal-pop-dual-monthlabel">{MONTHS_FULL[month]} {year}</p>
      <div className="cal-pop-grid">
        {WEEKDAYS.map((weekday, index) => <span className="cal-pop-wd" key={index}>{weekday}</span>)}
        {monthGridDays(year, month).map((date) => {
          const iso = toIsoDate(date);
          return (
            <button
              type="button"
              key={iso}
              className={rangeDayClasses({ iso, date, viewMonth: month, todayIso, from, to })}
              onClick={() => onPick(iso)}
            >
              {date.getDate()}
            </button>
          );
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
  const todayIso = useState(() => toIsoDate(new Date()))[0];
  const [view, setView] = useState(() => {
    const base = parseIsoDate(from) ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const { anchorRef, popoverRef, style } = useFloatingPopover(open);
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  /** Primeiro clique fixa o começo, segundo fecha o intervalo. Clicar antes do
   * começo não é erro: vira o intervalo, que é o que a pessoa quis dizer. */
  function pick(iso: string) {
    if (!pickingEnd) {
      onChange(iso, to && to > iso ? to : iso);
      setPickingEnd(true);
      return;
    }
    if (iso < from) onChange(iso, from);
    else onChange(from, iso);
    setPickingEnd(false);
    setOpen(false);
  }

  const second = nextMonth(view);

  return (
    <div className="daterange-field" ref={anchorRef}>
      <button
        type="button"
        className="daterange-trigger"
        onClick={() => { setOpen((current) => !current); setPickingEnd(false); }}
      >
        <span aria-hidden>◇</span>
        {from && to ? `${formatShortDayMonth(from)} → ${formatShortDayMonth(to)}` : "Selecionar período"}
      </button>
      <FloatingPanel open={open} popoverRef={popoverRef} style={style} className="cal-pop cal-pop-dual">
        <div className="cal-pop-bar">
          <button type="button" onClick={() => setView((v) => stepMonth(v, -1))} aria-label="Mês anterior">‹</button>
          <strong>{MONTHS_FULL[view.month]} {view.year} — {MONTHS_FULL[second.month]} {second.year}</strong>
          <button type="button" onClick={() => setView((v) => stepMonth(v, 1))} aria-label="Próximo mês">›</button>
        </div>
        <div className="cal-pop-dual-grids">
          <MonthGrid year={view.year} month={view.month} from={from} to={to} todayIso={todayIso} onPick={pick} />
          <MonthGrid year={second.year} month={second.month} from={from} to={to} todayIso={todayIso} onPick={pick} />
        </div>
        <div className="cal-pop-presets">
          {presets.map((days) => (
            <button
              type="button"
              key={days}
              className={activePreset === days ? "on" : ""}
              onClick={() => { onPreset(days); setOpen(false); }}
            >
              {days} dias
            </button>
          ))}
        </div>
      </FloatingPanel>
    </div>
  );
}
