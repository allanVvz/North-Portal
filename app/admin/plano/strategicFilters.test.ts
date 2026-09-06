import { describe, expect, it } from "vitest";
import {
  EMPTY_STRATEGIC_FILTER,
  filterPlans,
  isFilterActive,
  matchesWhen,
  matchesWho,
  matchesWhy,
  planPeople,
  planWindow,
  shouldAutoExpand,
  whyPreview,
} from "./strategicFilters";

type Activity = { assignee: string | null; due_date: string | null; start_date: string | null };

function plan(over: Partial<{
  assignee: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  activities: Activity[];
}> = {}) {
  return {
    assignee: null,
    description: null,
    start_date: null,
    end_date: null,
    due_date: null,
    activities: [],
    ...over,
  };
}

const activity = (over: Partial<Activity> = {}): Activity => ({ assignee: null, due_date: null, start_date: null, ...over });

describe("quem", () => {
  // O caso que a view Estratégica existe para mostrar: o plano é de uma pessoa
  // e o trabalho está com outras. Olhar só o responsável do pai esconderia isso.
  it("junta o responsável do plano com os das atividades", () => {
    const p = plan({
      assignee: "Allan",
      activities: [activity({ assignee: "Bia, Caio" }), activity({ assignee: "Bia" })],
    });
    expect(planPeople(p)).toEqual(["Allan", "Bia", "Caio"]);
    expect(matchesWho(p, "caio")).toBe(true);
  });

  it("ignora acento e caixa, e casa por pedaço do nome", () => {
    const p = plan({ assignee: "Antônio Fernandes" });
    expect(matchesWho(p, "antonio")).toBe(true);
    expect(matchesWho(p, "FERNANDES")).toBe(true);
    expect(matchesWho(p, "mariana")).toBe(false);
  });

  it("filtro vazio não exclui ninguém, nem o plano sem responsável", () => {
    expect(matchesWho(plan(), "")).toBe(true);
    expect(matchesWho(plan(), "   ")).toBe(true);
  });
});

describe("quando", () => {
  it("usa as datas do próprio plano quando existem", () => {
    expect(planWindow(plan({ start_date: "2026-09-01", end_date: "2026-09-30" }))).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });

  // Um plano sem data própria mas com atividades marcadas acontece em algum
  // momento; fingir que não o sumiria do filtro de período.
  it("cai para o intervalo das atividades quando o plano não tem data", () => {
    const p = plan({ activities: [activity({ due_date: "2026-10-05" }), activity({ start_date: "2026-09-20" })] });
    expect(planWindow(p)).toEqual({ start: "2026-09-20", end: "2026-10-05" });
  });

  it("plano sem data nenhuma não tem janela", () => {
    expect(planWindow(plan())).toBeNull();
  });

  // Interseção, não contenção: exigir que o plano coubesse inteiro na janela
  // esconderia justamente os planos longos.
  it("casa por interseção — um plano de 3 meses aparece ao olhar uma semana dentro dele", () => {
    const longo = plan({ start_date: "2026-07-01", end_date: "2026-09-30" });
    expect(matchesWhen(longo, "2026-08-10", "2026-08-16")).toBe(true);
    expect(matchesWhen(longo, "2026-10-01", "2026-10-31")).toBe(false);
    expect(matchesWhen(longo, "2026-01-01", "2026-06-30")).toBe(false);
  });

  it("aceita intervalo aberto de um lado só", () => {
    const p = plan({ start_date: "2026-09-10", end_date: "2026-09-20" });
    expect(matchesWhen(p, "2026-09-15", "")).toBe(true);
    expect(matchesWhen(p, "2026-09-25", "")).toBe(false);
    expect(matchesWhen(p, "", "2026-09-05")).toBe(false);
    expect(matchesWhen(p, "", "2026-09-15")).toBe(true);
  });

  it("plano sem data some quando se pergunta por um período, e fica quando não se pergunta", () => {
    expect(matchesWhen(plan(), "2026-09-01", "2026-09-30")).toBe(false);
    expect(matchesWhen(plan(), "", "")).toBe(true);
  });

  it("as pontas do intervalo entram no resultado", () => {
    const p = plan({ start_date: "2026-09-10", end_date: "2026-09-10" });
    expect(matchesWhen(p, "2026-09-10", "2026-09-10")).toBe(true);
  });
});

describe("por quê", () => {
  it("termos em E, sem acento, contra a justificativa", () => {
    const p = plan({ description: "Reduzir o custo por conversa no WhatsApp" });
    expect(matchesWhy(p, "custo conversa")).toBe(true);
    expect(matchesWhy(p, "whatsapp")).toBe(true);
    expect(matchesWhy(p, "custo instagram")).toBe(false);
  });

  it("plano sem justificativa só passa com filtro vazio", () => {
    expect(matchesWhy(plan(), "")).toBe(true);
    expect(matchesWhy(plan(), "custo")).toBe(false);
  });
});

describe("combinação dos três", () => {
  const plans = [
    plan({ assignee: "Allan", description: "Automação de ads", start_date: "2026-09-01", end_date: "2026-09-15" }),
    plan({ assignee: "Bia", description: "Automação de copy", start_date: "2026-10-01", end_date: "2026-10-15" }),
    plan({ assignee: "Allan", description: "Fluxo de atendimento", start_date: "2026-09-10", end_date: "2026-09-20" }),
  ];

  it("sem filtro devolve tudo, e devolve uma cópia", () => {
    const out = filterPlans(plans, EMPTY_STRATEGIC_FILTER);
    expect(out).toHaveLength(3);
    expect(out).not.toBe(plans);
    expect(isFilterActive(EMPTY_STRATEGIC_FILTER)).toBe(false);
  });

  it("os três filtros se somam (E), não se substituem", () => {
    expect(filterPlans(plans, { who: "allan", from: "", to: "", why: "" })).toHaveLength(2);
    expect(filterPlans(plans, { who: "allan", from: "", to: "", why: "automacao" })).toHaveLength(1);
    expect(
      filterPlans(plans, { who: "allan", from: "2026-09-16", to: "2026-09-30", why: "" }),
    ).toHaveLength(1);
  });
});

describe("auto-expandir", () => {
  it("abre sozinho abaixo de 5, e não com a lista cheia nem vazia", () => {
    expect(shouldAutoExpand(0)).toBe(false);
    expect(shouldAutoExpand(1)).toBe(true);
    expect(shouldAutoExpand(4)).toBe(true);
    expect(shouldAutoExpand(5)).toBe(false);
    expect(shouldAutoExpand(12)).toBe(false);
  });
});

describe("prévia da justificativa", () => {
  it("corta em palavra inteira e marca o corte", () => {
    const preview = whyPreview("Reduzir o custo por conversa iniciada no WhatsApp durante a campanha de setembro", 40);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(41);
    expect(preview).not.toMatch(/\s…$/);
  });

  it("texto curto passa inteiro, sem reticências", () => {
    expect(whyPreview("Automação de ads", 40)).toBe("Automação de ads");
    expect(whyPreview(null)).toBe("");
    expect(whyPreview("   ")).toBe("");
  });

  // Uma palavra única gigante não tem espaço para cortar: corta na letra mesmo,
  // em vez de devolver o texto inteiro por não achar onde quebrar.
  it("palavra única longa é cortada mesmo assim", () => {
    expect(whyPreview("A".repeat(80), 20)).toBe(`${"A".repeat(20)}…`);
  });
});
