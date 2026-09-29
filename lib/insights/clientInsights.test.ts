import { describe, expect, it } from "vitest";
import { followerWeeks, latestPerPeriod, weekFromSnapshot } from "./clientInsights";

const post = (metrics: Record<string, number>) => ({ source: "paid", metrics }) as never;

describe("mídia por semana a partir dos relatórios", () => {
  it("usa a última revisão de cada semana, ignorando a substituída", () => {
    const rows = [
      { period_to: "2026-09-27", revision: 1, status: "superseded" },
      { period_to: "2026-09-27", revision: 2, status: "generated" },
      { period_to: "2026-09-20", revision: 1, status: "finalized" },
    ];
    expect(latestPerPeriod(rows).map((row) => `${row.period_to}:${row.revision}`)).toEqual(["2026-09-20:1", "2026-09-27:2"]);
  });

  it("soma como o PDF e aplica o alcance corrigido pela equipe", () => {
    const row = {
      client_id: "c", occurrence_id: "o", period_from: "2026-09-21", period_to: "2026-09-27", revision: 1, status: "finalized", document_id: null,
      snapshot: { campaignPosts: [post({ custo: 100, alcance: 9000, profileVisits: 300 }), post({ custo: 50, alcance: 4000, contatos: 10 })] },
    };
    const week = weekFromSnapshot(row as never, 12452);
    expect(week).toMatchObject({ spend: 150, reach: 12452, reachCorrected: true, conversations: 10, outcome: "conversas", outcomeValue: 10, outcomeCost: 15 });
    expect(weekFromSnapshot(row as never, null)).toMatchObject({ reach: 13000, reachCorrected: false });
  });
});

describe("seguidores por semana", () => {
  it("junta o total da série com o ganho informado no Feedback", () => {
    const weeks = followerWeeks(
      [{ period_to: "2026-09-20", value: 8960 }],
      [{ period_to: "2026-09-27", metrics: { seguidores: 9078, seguidores_novos: 65 } }, { period_to: "2026-09-20", metrics: { seguidores_novos: "48" } }],
    );
    expect(weeks).toEqual([
      { periodTo: "2026-09-20", total: 8960, gain: 48 },
      { periodTo: "2026-09-27", total: 9078, gain: 65 },
    ]);
  });

  it("descarta total que não pode ser do perfil (igual ao ganho ou fracionário)", () => {
    expect(followerWeeks([], [{ period_to: "2026-09-27", metrics: { seguidores: 114, seguidores_novos: 114 } }])).toEqual([{ periodTo: "2026-09-27", total: null, gain: 114 }]);
    expect(followerWeeks([], [{ period_to: "2026-09-27", metrics: { seguidores: 30.9 } }])).toEqual([{ periodTo: "2026-09-27", total: null, gain: null }]);
  });
});
