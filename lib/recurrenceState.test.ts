import { describe, expect, it } from "vitest";
import { isRecurrenceTemplate } from "./recurrenceState";

describe("isRecurrenceTemplate", () => {
  it("é true quando recurrence_cadence está setado", () => {
    expect(isRecurrenceTemplate({ recurrence_cadence: "semanal" })).toBe(true);
  });

  it("é true quando payload.recurrence_group é true, mesmo sem recurrence_cadence", () => {
    expect(isRecurrenceTemplate({ recurrence_cadence: null, payload: { recurrence_group: true } })).toBe(true);
  });

  it("é false para uma execução comum (recurrence_cadence null, sem recurrence_group)", () => {
    expect(isRecurrenceTemplate({ recurrence_cadence: null, payload: { recurrence_parent_id: "molde-1" } })).toBe(false);
  });

  it("é false para um card comum, sem payload nenhum", () => {
    expect(isRecurrenceTemplate({})).toBe(false);
  });
});
