"use client";

import { useEffect, useState } from "react";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";
import {
  MONTHS_FULL,
  WEEKDAYS,
  formatFullDate,
  monthGridDays,
  parseIsoDate,
  parseTypedDate,
  rangeDayClasses,
  stepMonth,
  toIsoDate,
} from "./calendarGrid";

export type CalendarRecurrence = { cadence: "semanal" | "quinzenal" | "mensal" | null; weekdays: number[]; dayOfMonth: number | null };

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
  const selected = parseIsoDate(value);
  const [view, setView] = useState(() => {
    const base = selected ?? today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [text, setText] = useState(() => formatFullDate(value));

  // "end": o painel é largo e o campo costuma ficar à direita de um formulário
  // estreito, então ele abre alinhado pela borda direita da âncora.
  const { anchorRef, popoverRef, style } = useFloatingPopover(open, "end");
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  useEffect(() => setText(formatFullDate(value)), [value]);

  // Só a data de início é obrigatória. Sem dia-da-semana marcado a recorrência
  // fica no mesmo dia da semana em que começa — é um atalho, não um erro.
  const recurrenceError = recurrence?.cadence && !value ? "Escolha a data de início da recorrência." : "";
  const recurrenceHint = recurrence?.cadence && !recurrence.weekdays.length && value
    ? "Sem dia marcado: recorre no mesmo dia da semana da data de início."
    : "";

  function commitTyped() {
    const next = text.trim();
    if (!next) { onChange(""); return; }
    const parsed = parseTypedDate(next);
    if (parsed) onChange(toIsoDate(parsed)); else setText(formatFullDate(value));
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
    const startDay = parseIsoDate(value)?.getDay() ?? today.getDay();
    onRecurrenceChange(enabled
      ? { cadence: recurrence.cadence ?? "semanal", weekdays: recurrence.weekdays.length ? recurrence.weekdays : [startDay], dayOfMonth: parseIsoDate(value)?.getDate() ?? today.getDate() }
      : { cadence: null, weekdays: [], dayOfMonth: null });
  }

  const todayIso = toIsoDate(today);

  return (
    <div className="cal-pick" ref={anchorRef}>
      <div className="cal-pick-trigger">
        <button type="button" className="cal-pick-ico" aria-label="Abrir calendário" onClick={() => { setOpen((current) => !current); setEndpoint("start"); }}>◇</button>
        <input className="cal-pick-input" value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} onBlur={commitTyped} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commitTyped(); }
          if (event.key === "Escape") setText(formatFullDate(value));
        }} />
      </div>
      <FloatingPanel open={open} popoverRef={popoverRef} style={style} className="cal-pop cal-pop-range">
        <div className="cal-pop-bar">
          <button type="button" onClick={() => setView((v) => stepMonth(v, -1))} aria-label="Mês anterior">‹</button>
          <strong>{MONTHS_FULL[view.month]} {view.year}</strong>
          <button type="button" onClick={() => setView((v) => stepMonth(v, 1))} aria-label="Próximo mês">›</button>
        </div>
        <div className="cal-pop-grid">
          {WEEKDAYS.map((weekday, index) => <span className="cal-pop-wd" key={index}>{weekday}</span>)}
          {monthGridDays(view.year, view.month).map((date) => {
            const iso = toIsoDate(date);
            const classes = [
              rangeDayClasses({ iso, date, viewMonth: view.month, todayIso, from: value, to: endValue ?? "" }),
              iso === nextExecutionValue ? "next-execution" : "",
            ].filter(Boolean).join(" ");
            return <button type="button" key={iso} className={classes} onClick={() => chooseDate(iso)} aria-label={iso === nextExecutionValue ? `${formatFullDate(iso)}, próxima execução` : formatFullDate(iso)}>{date.getDate()}</button>;
          })}
        </div>

        {onEndChange ? (
          <div className="cal-range-summary" aria-label="Intervalo selecionado">
            <button type="button" className={endpoint === "start" ? "on" : ""} onClick={() => setEndpoint("start")}><small>Início</small><strong>{formatFullDate(value) || "Escolher"}</strong></button>
            <span>→</span>
            <button type="button" className={endpoint === "end" ? "on" : ""} onClick={() => setEndpoint("end")}><small>Fim</small><strong>{formatFullDate(endValue ?? "") || "Escolher"}</strong></button>
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
      </FloatingPanel>
    </div>
  );
}
