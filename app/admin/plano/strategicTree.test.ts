import { describe, expect, it } from "vitest";
import { buildStrategicTree, filterStrategicTree, hydratePlanDeliveries, linkedDeliveryIds } from "./strategicTree";

function parent(id: string, title: string, activities: unknown[] = [], clientName = "Acme") {
  return {
    id, title, activities, clientName, clientSlug: clientName.toLowerCase(), kind: "plano", typeLabel: "Plano",
  } as any;
}

describe("árvore estratégica de planos e entregas", () => {
  const deliveryA = parent("delivery-a", "Landing page", [parent("step-a", "Roteiro")]);
  const deliveryB = parent("delivery-b", "Relatório", [parent("step-b", "Revisar dados")]);
  const planA = parent("plan-a", "Aquisição", [deliveryA]);
  const planB = parent("plan-b", "Marca", [deliveryA]);

  it("deduplica raízes sem perder a entrega em cada plano legítimo", () => {
    const tree = buildStrategicTree([planA, planB], [deliveryA, deliveryB]);
    const roots = tree.flatMap((group) => group.roots);
    expect(roots.map((node) => node.card.id)).toEqual(["plan-a", "plan-b", "delivery-b"]);
    expect(roots.filter((node) => node.card.id === "plan-a")[0].deliveries.map((node) => node.card.id)).toEqual(["delivery-a"]);
    expect(roots.filter((node) => node.card.id === "plan-b")[0].deliveries.map((node) => node.card.id)).toEqual(["delivery-a"]);
    expect([...linkedDeliveryIds([planA, planB], [deliveryA, deliveryB])]).toEqual(["delivery-a"]);
  });

  it("hidrata a entrega aninhada com suas etapas", () => {
    const shallowPlan = parent("plan-a", "Aquisição", [parent("delivery-a", "Landing page")]);
    const hydrated = hydratePlanDeliveries([shallowPlan], [deliveryA]);
    expect(hydrated[0].activities[0]).toBe(deliveryA);
    expect((hydrated[0].activities[0] as any).activities[0].title).toBe("Roteiro");
  });

  it("não deixa um molde recorrente reaparecer como membro de um plano", () => {
    const recurringTemplate = { ...parent("routine-delivery", "Entrega mensal"), recurrence_cadence: "mensal" };
    const hydrated = hydratePlanDeliveries([parent("plan-a", "Aquisição", [recurringTemplate])], []);
    expect(hydrated[0].activities).toEqual([]);
    expect(buildStrategicTree([parent("plan-a", "Aquisição", [recurringTemplate])], [recurringTemplate]).flatMap((group) => group.roots).map((node) => node.card.id)).toEqual(["plan-a"]);
  });

  it("mantém o plano ancestral quando a busca encontra uma entrega ou etapa", () => {
    const tree = buildStrategicTree([planA], [deliveryA, deliveryB]);
    const filtered = filterStrategicTree(tree, (card) => card.title === "Landing page" || card.activities.some((step) => step.title === "Roteiro"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].roots[0].card.id).toBe("plan-a");
    expect(filtered[0].roots[0].deliveries[0].card.id).toBe("delivery-a");
  });
});
