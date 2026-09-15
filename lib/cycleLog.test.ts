import { describe, expect, it } from "vitest";
import { appendCycleLog, cycleLogOf } from "./cycleLog";

const entry = (cycle: number) => ({ cycle, due_date: "2026-09-15", completed_at: `2026-09-15T1${cycle}:00:00Z`, by: "Luiza", by_id: "p1" });

describe("cycleLog", () => {
  it("payload sem log devolve lista vazia", () => {
    expect(cycleLogOf({})).toEqual([]);
    expect(cycleLogOf(null)).toEqual([]);
  });

  it("descarta entrada malformada", () => {
    expect(cycleLogOf({ cycle_log: [entry(1), { cycle: 2 }, null] })).toEqual([entry(1)]);
  });

  it("acrescenta no fim e respeita o teto", () => {
    const payload = { cycle_log: [entry(1), entry(2)] };
    expect(appendCycleLog(payload, entry(3), 2)).toEqual([entry(2), entry(3)]);
  });
});
