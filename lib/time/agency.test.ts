import { describe, expect, it } from "vitest";
import { addDaysIso, agencyToday, todayInTimezone } from "./agency";

describe("relógio da agência", () => {
  it("às 22:00 em Brasília ainda é o mesmo dia, mesmo com UTC já no seguinte", () => {
    const lateEvening = new Date("2026-09-16T01:00:00Z"); // 22:00 de 15/09 em São Paulo
    expect(agencyToday(lateEvening)).toBe("2026-09-15");
    expect(todayInTimezone("UTC", lateEvening)).toBe("2026-09-16");
  });

  it("fuso inválido cai no da agência", () => {
    expect(todayInTimezone("Nao/Existe", new Date("2026-09-16T01:00:00Z"))).toBe("2026-09-15");
  });

  it("soma dias corridos atravessando mês", () => {
    expect(addDaysIso("2026-09-28", 6)).toBe("2026-10-04");
    expect(addDaysIso("2026-09-22", -4)).toBe("2026-09-18");
  });
});
