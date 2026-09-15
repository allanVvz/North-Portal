import { describe, expect, it } from "vitest";
import { blueprintSchema } from "./blueprint";
import { automationBlueprint, defaultPublishDate, flowBlueprint, planBlueprint, routineBlueprint, shootDayBlueprint } from "./recipes";

describe("receitas do Estúdio", () => {
  it("diária: plano + um createShootDay com peças, formatos e datas de publicação", () => {
    const { blueprint, preview } = shootDayBlueprint({
      clientSlug: "tock-fatal",
      clientName: "Tock Fatal",
      shootDate: "2026-09-22",
      typeKey: "criativo",
      assignee: "Luiza",
      docUrl: "https://docs.google.com/document/d/abc/edit",
      withPlan: true,
      pieces: [
        { title: "Antes e depois", format: "reels", publishDate: null, body: "gancho" },
        { title: "Carrossel de dicas", format: "carrossel", publishDate: "2026-10-01", body: "" },
      ],
    });
    expect(blueprintSchema.parse(blueprint)).toBeTruthy();
    expect(blueprint.ops.map((op) => op.op)).toEqual(["createTask", "createShootDay"]);
    const day = blueprint.ops[1];
    if (day.op !== "createShootDay") throw new Error("esperava a diária");
    expect(day.planRef).toBe("plano");
    expect(day.pieces).toEqual([
      { title: "Reels — Antes e depois", formato: "Reels vertical", publishDate: defaultPublishDate("2026-09-22", 0), description: "gancho" },
      { title: "Carrossel de dicas", formato: "Carrossel", publishDate: "2026-10-01", description: null },
    ]);
    expect(day.scriptDescription).toContain("docs.google.com");
    expect(day.captureTitle).toBe("Gravação 22/09 — 2 publicações");
    expect(preview.filter((line) => line.indent)).toHaveLength(2);
  });

  it("plano: atividades do volume de conteúdo ligadas ao plano, com design para banner/story", () => {
    const { blueprint } = planBlueprint({ clientSlug: "baita", title: "Plano outubro", startDate: "2026-10-01", assignee: null, counts: { reels: 2, banner: 3 }, extraTasks: ["Revisar bio"] });
    expect(blueprintSchema.parse(blueprint)).toBeTruthy();
    const titles = blueprint.ops.flatMap((op) => (op.op === "createTask" ? [op.task.title] : []));
    expect(titles[0]).toBe("Plano outubro");
    expect(titles).toContain("Design — 3 banners");
    expect(titles).toContain("Revisar bio");
    expect(blueprint.ops.slice(1).every((op) => op.op === "createTask" && op.planRef === "plano")).toBe(true);
  });

  it("rotina com cadência vira scope routine; sem cadência vira tarefa única", () => {
    const weekly = routineBlueprint({ clientSlug: "baita", title: "Assessoria semanal", description: null, cadence: "semanal", startDate: "2026-09-16", weekdays: [3], assignee: "Allan" });
    expect(weekly.blueprint.ops[0]).toMatchObject({ scope: "routine", task: { recurrence_cadence: "semanal", recurrence_weekdays: [3] } });
    const once = routineBlueprint({ clientSlug: "baita", title: "Kickoff", description: null, cadence: null, startDate: "2026-09-17", weekdays: [], assignee: null });
    expect(once.blueprint.ops[0]).toMatchObject({ scope: "task" });
  });

  it("fluxo: N entregas do tipo, com formato", () => {
    const { blueprint } = flowBlueprint({ clientSlug: "baita", typeKey: "criativo", typeLabel: "Entrega", title: "Reels promo", count: 3, format: "reels", dueDate: "2026-09-30", assignee: null, planId: null });
    expect(blueprint.ops).toHaveLength(3);
    expect(blueprint.ops[2]).toMatchObject({ task: { title: "Reels promo 3", kind: "criativo", formato: "Reels vertical" } });
  });

  it("automação: cria a rotina-alvo quando não há card, e exige alvo", () => {
    const { blueprint } = automationBlueprint({
      clientSlug: "baita",
      automationKey: "relatorio_trafego_semanal",
      targetTaskId: null,
      targetTitle: null,
      newTarget: { title: "Relatório semanal", cadence: "semanal", startDate: "2026-09-21", assignee: null },
      performanceTemplateId: null,
    });
    expect(blueprintSchema.parse(blueprint)).toBeTruthy();
    expect(blueprint.ops[1]).toMatchObject({ op: "createAutomation", targetRef: "alvo" });
    expect(() => automationBlueprint({ clientSlug: null, automationKey: "relatorio_trafego_semanal", targetTaskId: null, targetTitle: null, newTarget: null, performanceTemplateId: null })).toThrow(/rotina/);
  });
});
