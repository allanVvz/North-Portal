import { describe, expect, it } from "vitest";
import { flowDemotionProblem } from "./demotion";

describe("flowDemotionProblem", () => {
  it("não recusa um card comum trocando de tipo comum", () => {
    expect(flowDemotionProblem({ title: "Tarefa", payload: {} })).toBeNull();
  });

  it("recusa despromover uma entrega (flow_parent) com um erro legível", () => {
    const problem = flowDemotionProblem({ title: 'Post "Evento 19/09"', payload: { flow_parent: true } });
    expect(problem).not.toBeNull();
    expect(problem).toContain("Evento 19/09");
  });
});
