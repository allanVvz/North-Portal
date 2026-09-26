import { describe, expect, it } from "vitest";
import { classifyTask, normalizeDeliveryPayload, resolveTaskClassification, taskClassificationLabel } from "./taskClassification";
import type { TaskTypeDef } from "./taskTypes";

function type(key: string, label: string, behavior: TaskTypeDef["behavior"], subtypes: TaskTypeDef["subtypes"] = []): TaskTypeDef {
  return {
    id: key, key, label, behavior, subtypes, order_index: 10, creatable: true, active: true,
    icon: null, tone: null, show_in_performance: false, workflowSteps: [],
    ...(behavior === "entrega" ? { workflow_version_id: `${key}-published` } : {}),
  };
}

const types = [
  type("operacional", "Tarefa", "simples", [{ key: "reels", label: "Reels", order_index: 10, lead_days: 1, progress_weight: 1, default_assignee: null, client_visible: false }]),
  type("plano_acao", "Plano", "plano"),
  ...["criativo", "automacao", "entrega_reels", "entrega_story", "entrega_carrossel", "entrega_anuncio", "entrega_banner"]
    .map((key) => type(key, ({ criativo: "Criativo", automacao: "Automação", entrega_reels: "Reels", entrega_story: "Story", entrega_carrossel: "Carrossel", entrega_anuncio: "Anúncio", entrega_banner: "Banner" } as Record<string, string>)[key], "entrega")),
];

describe("Tipo × Subtipo", () => {
  it.each([
    ["operacional", "reels", "tarefa", "Reels", "Tarefa · Reels"],
    ["criativo", null, "entrega", "Criativo", "Entrega · Criativo"],
    ["automacao", null, "entrega", "Automação", "Entrega · Automação"],
    ["entrega_reels", null, "entrega", "Reels", "Entrega · Reels"],
    ["entrega_story", null, "entrega", "Story", "Entrega · Story"],
    ["entrega_carrossel", null, "entrega", "Carrossel", "Entrega · Carrossel"],
    ["entrega_anuncio", null, "entrega", "Anúncio", "Entrega · Anúncio"],
    ["entrega_banner", null, "entrega", "Banner", "Entrega · Banner"],
    ["plano_acao", null, "plano", null, "Plano"],
  ])("projeta %s/%s", (kind, subtype, base, label, display) => {
    const result = classifyTask(kind!, subtype, types);
    expect(result).toMatchObject({ baseType: base, subtypeLabel: label, kind, subtype });
    expect(taskClassificationLabel(kind!, subtype, types)).toBe(display);
    if (base !== "plano") expect(resolveTaskClassification(base as "tarefa" | "entrega", result.subtypeKey, types)).toEqual({ kind, subtype });
  });

  it("mantém a distinção entre Tarefa · Reels e Entrega · Reels", () => {
    expect(resolveTaskClassification("tarefa", "reels", types)).toEqual({ kind: "operacional", subtype: "reels" });
    expect(resolveTaskClassification("entrega", "entrega_reels", types)).toEqual({ kind: "entrega_reels", subtype: null });
    expect(classifyTask("entrega_reels", null, types).workflowVersionId).toBe("entrega_reels-published");
  });

  it("mantém Checkpoint somente para leitura", () => {
    expect(classifyTask("checkpoint_comercial").baseType).toBe("checkpoint");
    expect(resolveTaskClassification("entrega", "checkpoint_comercial", types)).toBeNull();
  });

  it("fixa payload.formato das variantes sem mexer em formatos históricos", () => {
    for (const [kind, format] of [
      ["entrega_reels", "Reels"], ["entrega_story", "Story"], ["entrega_carrossel", "Carrossel"],
      ["entrega_anuncio", "Anúncio"], ["entrega_banner", "Banner"],
    ]) {
      expect(normalizeDeliveryPayload(kind, { formato: "Relatório" })).toEqual({ formato: format });
    }
    expect(normalizeDeliveryPayload("criativo", { formato: "Relatório" })).toEqual({ formato: "Relatório" });
  });
});
