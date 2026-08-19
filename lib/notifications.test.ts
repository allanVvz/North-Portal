import { describe, expect, it } from "vitest";
import { DUE_SOON_WINDOW_DAYS, dueSoonMessage, isDueSoon } from "./notifications";

const TODAY = new Date("2026-08-19T15:30:00Z");

describe("isDueSoon", () => {
  it("null due date is never due soon", () => {
    expect(isDueSoon(null, TODAY)).toBe(false);
  });

  it("due today is within the window", () => {
    expect(isDueSoon("2026-08-19", TODAY)).toBe(true);
  });

  it("due tomorrow is within the default (48h/2-day) window", () => {
    expect(isDueSoon("2026-08-20", TODAY)).toBe(true);
  });

  it("due at the edge of the default window (2 days out) is included", () => {
    expect(isDueSoon("2026-08-21", TODAY)).toBe(true);
  });

  it("due 3 days out is outside the default window", () => {
    expect(isDueSoon("2026-08-22", TODAY)).toBe(false);
  });

  it("already overdue (yesterday) is not 'approaching'", () => {
    expect(isDueSoon("2026-08-18", TODAY)).toBe(false);
  });

  it("ignores time-of-day on the reference instant (date-only comparison)", () => {
    const lateInDay = new Date("2026-08-19T23:59:00Z");
    expect(isDueSoon("2026-08-19", lateInDay)).toBe(true);
  });

  it("honors a custom window", () => {
    expect(isDueSoon("2026-08-23", TODAY, 5)).toBe(true);
    expect(isDueSoon("2026-08-23", TODAY, 3)).toBe(false);
  });

  it("default window constant is 2 days (~24-48h)", () => {
    expect(DUE_SOON_WINDOW_DAYS).toBe(2);
  });
});

describe("dueSoonMessage", () => {
  it("formats the due date as pt-BR DD/MM/YYYY", () => {
    expect(dueSoonMessage("Publicar post", "2026-08-20")).toBe(
      'Prazo próximo: "Publicar post" vence em 20/08/2026.',
    );
  });

  it("tolerates a full ISO timestamp, using only the date part", () => {
    expect(dueSoonMessage("Roteiro", "2026-08-05T00:00:00.000Z")).toBe(
      'Prazo próximo: "Roteiro" vence em 05/08/2026.',
    );
  });
});
