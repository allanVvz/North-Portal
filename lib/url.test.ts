import { describe, expect, it } from "vitest";
import { withoutParam } from "./url";

describe("withoutParam", () => {
  it("tira só a chave pedida e preserva as demais", () => {
    expect(withoutParam("/admin/operacao", "task=abc&situacao=atrasada", "task")).toBe("/admin/operacao?situacao=atrasada");
  });

  it("sem mais nada sobrando, devolve o caminho puro (sem `?`)", () => {
    expect(withoutParam("/admin/kanban", "task=abc", "task")).toBe("/admin/kanban");
  });

  it("chave ausente não altera nada", () => {
    expect(withoutParam("/admin/operacao", "situacao=parada", "task")).toBe("/admin/operacao?situacao=parada");
  });
});
