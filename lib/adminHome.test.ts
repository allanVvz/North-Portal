import { describe, expect, it } from "vitest";
import {
  averageProgress,
  deriveClientsNeedingAttention,
  isOverdue,
  plansInProgress,
  weekAhead,
  type OverviewLike,
} from "./adminHome";

function client(patch: Partial<OverviewLike> = {}): OverviewLike {
  return {
    slug: "acme",
    name: "Acme",
    is_active: true,
    briefing_submitted: true,
    metricsCount: 2,
    hasReport: true,
    planCount: 1,
    ...patch,
  };
}

describe("deriveClientsNeedingAttention", () => {
  it("ignores clients with nothing missing", () => {
    expect(deriveClientsNeedingAttention([client()])).toEqual([]);
  });

  it("skips inactive clients so they don't bury the real work", () => {
    const inactive = client({ is_active: false, briefing_submitted: false, metricsCount: 0, hasReport: false, planCount: 0 });
    expect(deriveClientsNeedingAttention([inactive])).toEqual([]);
  });

  it("collects one reason per gap", () => {
    const rows = deriveClientsNeedingAttention([
      client({ slug: "a", name: "A", briefing_submitted: false, metricsCount: 0, hasReport: false, planCount: 0 }),
    ]);
    expect(rows[0].reasons).toEqual(["briefing_pendente", "sem_metricas", "sem_relatorio", "sem_plano"]);
  });

  it("sorts most-broken first, then by name", () => {
    const rows = deriveClientsNeedingAttention([
      client({ slug: "z", name: "Zulu", hasReport: false }),
      client({ slug: "b", name: "Bravo", hasReport: false, metricsCount: 0 }),
      client({ slug: "a", name: "Alfa", hasReport: false }),
    ]);
    expect(rows.map((r) => r.slug)).toEqual(["b", "a", "z"]);
  });
});

describe("plansInProgress / averageProgress", () => {
  it("excludes finished and halted plans", () => {
    const plans = [
      { status: "em_producao" as const, progress: 40 },
      { status: "aprovado" as const, progress: 100 },
      { status: "parada" as const, progress: 10 },
    ];
    expect(plansInProgress(plans)).toHaveLength(1);
    expect(averageProgress(plans)).toBe(40);
  });

  it("returns 0 rather than NaN when nothing is running", () => {
    expect(averageProgress([{ status: "aprovado", progress: 100 }])).toBe(0);
    expect(averageProgress([])).toBe(0);
  });

  it("rounds the mean", () => {
    const plans = [
      { status: "backlog" as const, progress: 10 },
      { status: "backlog" as const, progress: 15 },
    ];
    expect(averageProgress(plans)).toBe(13);
  });
});

describe("isOverdue", () => {
  const today = "2026-08-25";

  it("is false without a due date", () => {
    expect(isOverdue({ id: "1", title: "x", due_date: null, status: "backlog" }, today)).toBe(false);
  });

  it("is false for finished work even when the date passed", () => {
    expect(isOverdue({ id: "1", title: "x", due_date: "2026-08-01", status: "aprovado" }, today)).toBe(false);
  });

  it("is false on the due date itself", () => {
    expect(isOverdue({ id: "1", title: "x", due_date: today, status: "backlog" }, today)).toBe(false);
  });

  it("is true once the date has passed", () => {
    expect(isOverdue({ id: "1", title: "x", due_date: "2026-08-24", status: "backlog" }, today)).toBe(true);
  });
});

describe("weekAhead", () => {
  const today = "2026-08-25";
  const tasks = [
    { id: "past", title: "past", due_date: "2026-08-20", status: "backlog" as const },
    { id: "today", title: "today", due_date: today, status: "backlog" as const },
    { id: "soon", title: "soon", due_date: "2026-08-28", status: "backlog" as const },
    { id: "edge", title: "edge", due_date: "2026-09-01", status: "backlog" as const },
    { id: "far", title: "far", due_date: "2026-09-05", status: "backlog" as const },
    { id: "done", title: "done", due_date: "2026-08-26", status: "aprovado" as const },
  ];

  it("keeps today through the 7th day, sorted, excluding finished work", () => {
    expect(weekAhead(tasks, today).map((t) => t.id)).toEqual(["today", "soon", "edge"]);
  });
});
