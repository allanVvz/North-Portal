import { describe, expect, it } from "vitest";
import { flowDemotionProblem } from "./demotion";

describe("flowDemotionProblem", () => {
  it("não recusa um card comum trocando de tipo comum", () => {
    expect(flowDemotionProblem({ title: "Tarefa", payload: {}, workflow_version_id: null })).toBeNull();
  });

  it("recusa despromover uma Entrega versionada com um erro legível", () => {
    const problem = flowDemotionProblem({ title: 'Post "Evento 19/09"', payload: {}, workflow_version_id: "workflow-v1" });
    expect(problem).not.toBeNull();
    expect(problem).toContain("Evento 19/09");
  });
});
