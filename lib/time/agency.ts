// O relógio da agência — uma fonte só para "hoje" e para o fuso operacional.
//
// Mora em lib/ (e não em app/admin) porque rotas de API, casos de uso e telas
// precisam da mesma semântica: o servidor roda em UTC, e a partir das 21:00 em
// Brasília um `new Date()` já diria "amanhã" — rotinas e prazos ficavam
// atrasados três horas antes da hora.

export const AGENCY_TIMEZONE = "America/Sao_Paulo";

/** "Hoje" como YYYY-MM-DD no fuso informado (cai no fuso da agência se o nome for inválido). */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formata como YYYY-MM-DD, o formato que comparamos.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_TIMEZONE }).format(now);
  }
}

/** "Hoje" da agência (America/Sao_Paulo). */
export function agencyToday(now: Date = new Date()): string {
  return todayInTimezone(AGENCY_TIMEZONE, now);
}

/** Soma dias CORRIDOS a uma data YYYY-MM-DD (meio-dia UTC evita virada de dia). */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
