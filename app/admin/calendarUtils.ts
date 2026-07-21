export type CalendarMonthOptions = {
  weekStartsOn?: 0 | 1;
  fixedWeeks?: boolean;
};

/** Shared month grid engine for Tarefas and Rotinas. */
export function calendarMonthDates(year: number, monthIndex: number, options: CalendarMonthOptions = {}): Date[] {
  const weekStartsOn = options.weekStartsOn ?? 0;
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = options.fixedWeeks === false ? Math.ceil((offset + daysInMonth) / 7) * 7 : 42;
  return Array.from({ length: cellCount }, (_, index) => new Date(year, monthIndex, index - offset + 1));
}

export function calendarMonthCells(year: number, monthIndex: number, weekStartsOn: 0 | 1 = 0): (Date | null)[] {
  return calendarMonthDates(year, monthIndex, { weekStartsOn, fixedWeeks: false })
    .map((date) => date.getMonth() === monthIndex ? date : null);
}

export function isoCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarMonthTitle(date: Date): string {
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
