import { describe, expect, it } from "vitest";
import { assigneeOptions, formatAssignees, parseAssignees } from "./assignees";

describe("responsáveis múltiplos", () => {
  it("normaliza, remove duplicados e preserva nomes reutilizáveis", () => {
    expect(parseAssignees("Ana, Bruno, ana,  Carla ")).toEqual(["Ana", "Bruno", "Carla"]);
    expect(formatAssignees(["Ana", "Bruno", "Ana"])).toBe("Ana, Bruno");
    expect(assigneeOptions(["Bruno, Ana", "Carla", "Ana"])).toEqual(["Ana", "Bruno", "Carla"]);
  });
});
