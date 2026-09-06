// A aritmética de calendário que os dois seletores de data do admin usavam em
// cópia: `CalendarPicker` (um mês, data única ou intervalo, com recorrência) e
// `DateRangeField` (dois meses lado a lado, só intervalo).
//
// Ficaram duplicadas porque nasceram em telas diferentes, e a cópia já tinha
// começado a divergir — o que é perigoso justamente aqui: se um dos dois montar
// a grade do mês com uma regra e o outro com outra, a mesma data cai em células
// diferentes em cada tela.
//
// Tudo aqui é puro e trabalha em horário LOCAL de propósito. Uma data de
// calendário é um dia do calendário de quem olha, não um instante: usar UTC
// faria "hoje" virar ontem para todo mundo a oeste de Greenwich durante as
// primeiras horas do dia.

export const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Uma letra por dia, começando no domingo — a mesma ordem de `Date#getDay()`. */
export const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** `2026-09-06` (ou o começo de um ISO mais longo) → Date local. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** `2026-09-06` → `06/09/2026`. Vazio quando não dá para ler a data. */
export function formatFullDate(value: string): string {
  const date = parseIsoDate(value);
  return date
    ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`
    : "";
}

/** `2026-09-06` → `06/09`. O rótulo curto do gatilho de intervalo. */
export function formatShortDayMonth(value: string): string {
  const date = parseIsoDate(value);
  return date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

/** O que a pessoa digita no campo: `6/9`, `06/09/26`, `6/9/2026`. Sem ano,
 * assume o ano corrente. Devolve null se a data não existir de fato (31/02),
 * porque `new Date(2026, 1, 31)` rola para março em silêncio. */
export function parseTypedDate(text: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : new Date().getFullYear();
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** As 42 células de um mês: 6 semanas fixas começando no domingo anterior ao
 * dia 1. Fixo, e não "o que couber", para a grade não mudar de altura de mês
 * para mês e empurrar o resto do popover para cima e para baixo. */
export function monthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

/** O mês seguinte a `{year, month}`, com a virada de ano resolvida pelo Date. */
export function nextMonth(view: { year: number; month: number }): { year: number; month: number } {
  const date = new Date(view.year, view.month + 1, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function stepMonth(view: { year: number; month: number }, direction: -1 | 1): { year: number; month: number } {
  const date = new Date(view.year, view.month + direction, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** As classes de estado de um dia dentro de uma grade de intervalo.
 *
 * `in-range` é estritamente entre as pontas: as pontas já têm classe própria, e
 * sobrepor as duas coisas pintaria o começo e o fim com o fundo do miolo. */
export function rangeDayClasses(args: {
  iso: string;
  date: Date;
  viewMonth: number;
  todayIso: string;
  from: string;
  to: string;
}): string {
  const { iso, date, viewMonth, todayIso, from, to } = args;
  return [
    "cal-pop-day",
    date.getMonth() !== viewMonth ? "out" : "",
    iso === todayIso ? "today" : "",
    iso === from ? "range-start" : "",
    iso === to ? "range-end" : "",
    from && to && iso > from && iso < to ? "in-range" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
