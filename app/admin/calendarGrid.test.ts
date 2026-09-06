import { describe, expect, it } from "vitest";
import {
  formatFullDate,
  formatShortDayMonth,
  monthGridDays,
  nextMonth,
  parseIsoDate,
  parseTypedDate,
  rangeDayClasses,
  stepMonth,
  toIsoDate,
} from "./calendarGrid";

describe("leitura e escrita de data", () => {
  // Horário local, não UTC: `new Date("2026-09-06")` seria meia-noite UTC, que
  // no Brasil é dia 5 — a data cairia na célula errada da grade.
  it("faz round-trip sem escorregar de dia", () => {
    const date = parseIsoDate("2026-09-06");
    expect(date?.getDate()).toBe(6);
    expect(date?.getMonth()).toBe(8);
    expect(toIsoDate(date!)).toBe("2026-09-06");
  });

  it("aceita ISO com hora e recusa lixo", () => {
    expect(toIsoDate(parseIsoDate("2026-09-06T13:45:00Z")!)).toBe("2026-09-06");
    expect(parseIsoDate("06/09/2026")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });

  it("formata com zero à esquerda nos dois tamanhos", () => {
    expect(formatFullDate("2026-01-02")).toBe("02/01/2026");
    expect(formatShortDayMonth("2026-01-02")).toBe("02/01");
    expect(formatFullDate("nada")).toBe("");
  });
});

describe("data digitada à mão", () => {
  it("aceita as três formas que a pessoa escreve", () => {
    expect(toIsoDate(parseTypedDate("6/9/2026")!)).toBe("2026-09-06");
    expect(toIsoDate(parseTypedDate("06/09/26")!)).toBe("2026-09-06");
    expect(parseTypedDate("6/9")?.getFullYear()).toBe(new Date().getFullYear());
  });

  // `new Date(2026, 1, 31)` rola para 3 de março em silêncio; sem a conferência
  // o campo aceitaria 31/02 e gravaria outro dia.
  it("recusa data que não existe em vez de rolar para o mês seguinte", () => {
    expect(parseTypedDate("31/02/2026")).toBeNull();
    expect(parseTypedDate("32/01/2026")).toBeNull();
    expect(parseTypedDate("6-9-2026")).toBeNull();
  });
});

describe("grade do mês", () => {
  it("são sempre 42 células, começando no domingo anterior ao dia 1", () => {
    // Setembro/2026 começa numa terça.
    const days = monthGridDays(2026, 8);
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(0);
    expect(toIsoDate(days[0])).toBe("2026-08-30");
    expect(days.some((d) => toIsoDate(d) === "2026-09-01")).toBe(true);
  });

  it("altura fixa mesmo num mês que começa no domingo", () => {
    // Fevereiro/2026 começa num domingo — a grade não encolhe.
    expect(monthGridDays(2026, 1)).toHaveLength(42);
    expect(toIsoDate(monthGridDays(2026, 1)[0])).toBe("2026-02-01");
  });

  it("vira o ano nas duas direções", () => {
    expect(nextMonth({ year: 2026, month: 11 })).toEqual({ year: 2027, month: 0 });
    expect(stepMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(stepMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  });
});

describe("estado visual de um dia no intervalo", () => {
  const base = { viewMonth: 8, todayIso: "2026-09-10", from: "2026-09-05", to: "2026-09-09" };
  const classesFor = (iso: string) =>
    rangeDayClasses({ iso, date: parseIsoDate(iso)!, ...base }).split(" ");

  it("marca as pontas e o miolo, sem sobrepor os dois", () => {
    expect(classesFor("2026-09-05")).toContain("range-start");
    expect(classesFor("2026-09-05")).not.toContain("in-range");
    expect(classesFor("2026-09-07")).toContain("in-range");
    expect(classesFor("2026-09-09")).toContain("range-end");
    expect(classesFor("2026-09-09")).not.toContain("in-range");
  });

  it("marca hoje e os dias que vazam do mês vizinho", () => {
    expect(classesFor("2026-09-10")).toContain("today");
    expect(classesFor("2026-10-01")).toContain("out");
    expect(classesFor("2026-09-10")).not.toContain("out");
  });

  it("sem intervalo fechado, ninguém fica em `in-range`", () => {
    const solto = rangeDayClasses({
      iso: "2026-09-07",
      date: parseIsoDate("2026-09-07")!,
      viewMonth: 8,
      todayIso: "2026-09-10",
      from: "2026-09-05",
      to: "",
    });
    expect(solto).not.toContain("in-range");
  });
});
