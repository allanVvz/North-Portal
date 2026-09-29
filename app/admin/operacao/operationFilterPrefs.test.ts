import { describe, expect, it } from "vitest";
import { withDefaultStatus } from "./operationFilterPrefs";
import { DEFAULT_OPERATION_FILTERS } from "./operationItems";

describe("filtros lembrados da Operação", () => {
  it("um conjunto antigo sem status volta a esconder os concluídos", () => {
    const stored = [{ attr: "cliente" as const, value: "Baita", label: "Baita" }];
    expect(withDefaultStatus(stored)).toEqual([...DEFAULT_OPERATION_FILTERS, ...stored]);
  });

  it("status gravado (inclusive Concluído) é descartado; o padrão sempre vale", () => {
    const stored = [{ attr: "status" as const, value: "aprovado", label: "Concluído" }, { attr: "situacao" as const, value: "atrasada", label: "Atrasada" }];
    expect(withDefaultStatus(stored)).toEqual([...DEFAULT_OPERATION_FILTERS]);
    expect(withDefaultStatus(stored).some((filter) => filter.value === "aprovado")).toBe(false);
  });
});
