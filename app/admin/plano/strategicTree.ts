import type { ActionPlan, FlowDelivery, ParentCard } from "@/lib/supabase";
import { isRecurrenceTemplate } from "@/lib/recurrenceState";

/**
 * A leitura Estratégica tem duas fontes: os Planos e as Entregas.  Uma entrega
 * pode estar em mais de um plano (referência legítima), por isso a árvore não
 * tenta impor um pai exclusivo.  O que ela garante é que uma entrega ligada
 * nunca ganhe uma terceira aparição como raiz solta.
 */
export type StrategicNode = {
  card: ParentCard;
  kind: "plan" | "delivery";
  deliveries: StrategicNode[];
};

export type StrategicClientGroup = {
  key: string;
  clientName: string;
  roots: StrategicNode[];
};

const NO_CLIENT = "__sem_cliente__";

export function linkedDeliveryIds(plans: readonly ActionPlan[], deliveries: readonly FlowDelivery[]): Set<string> {
  const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));
  const linked = new Set<string>();
  for (const plan of plans) {
    for (const member of plan.activities) {
      if (deliveryIds.has(member.id)) linked.add(member.id);
    }
  }
  return linked;
}

/** Replaces a delivery member with the fully loaded FlowDelivery (and stages). */
export function hydratePlanDeliveries(plans: readonly ActionPlan[], deliveries: readonly FlowDelivery[]): ActionPlan[] {
  const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  return plans.map((plan) => ({
    ...plan,
    activities: plan.activities
      .filter((member) => !isRecurrenceTemplate(member))
      .map((member) => byId.get(member.id) ?? member),
  }));
}

export function buildStrategicTree(
  plans: readonly ActionPlan[],
  deliveries: readonly FlowDelivery[],
): StrategicClientGroup[] {
  const visibleDeliveries = deliveries.filter((delivery) => !isRecurrenceTemplate(delivery));
  const hydratedPlans = hydratePlanDeliveries(plans.filter((plan) => !isRecurrenceTemplate(plan)), visibleDeliveries);
  const deliveryById = new Map(visibleDeliveries.map((delivery) => [delivery.id, delivery]));
  const linked = linkedDeliveryIds(hydratedPlans, visibleDeliveries);
  const groups = new Map<string, StrategicClientGroup>();

  const groupFor = (card: ParentCard) => {
    const key = card.clientSlug || NO_CLIENT;
    const existing = groups.get(key);
    if (existing) return existing;
    const next = { key, clientName: card.clientName || "Sem cliente", roots: [] };
    groups.set(key, next);
    return next;
  };

  for (const plan of hydratedPlans) {
    const nested = plan.activities
      .map((member) => deliveryById.get(member.id))
      .filter((delivery): delivery is FlowDelivery => Boolean(delivery))
      .map((delivery) => ({ card: delivery, kind: "delivery" as const, deliveries: [] }));
    groupFor(plan).roots.push({ card: plan, kind: "plan", deliveries: nested });
  }

  for (const delivery of visibleDeliveries) {
    if (!linked.has(delivery.id)) {
      groupFor(delivery).roots.push({ card: delivery, kind: "delivery", deliveries: [] });
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, roots: group.roots.filter(Boolean) }))
    .filter((group) => group.roots.length > 0)
    .sort((a, b) => {
      if (a.key === NO_CLIENT) return 1;
      if (b.key === NO_CLIENT) return -1;
      return a.clientName.localeCompare(b.clientName, "pt-BR");
    });
}

/**
 * A busca não desmonta a hierarquia: uma Entrega/etapa encontrada conserva o
 * Plano que lhe dá contexto. Quando o Plano casa por si, seus filhos ficam
 * visíveis para a leitura continuar completa.
 */
export function filterStrategicTree(
  groups: readonly StrategicClientGroup[],
  matches: (card: ParentCard) => boolean,
): StrategicClientGroup[] {
  return groups
    .map((group) => {
      const roots = group.roots.flatMap((node) => {
        if (node.kind === "delivery") return matches(node.card) ? [node] : [];
        const planMatches = matches(node.card);
        const deliveries = planMatches ? node.deliveries : node.deliveries.filter((delivery) => matches(delivery.card));
        return planMatches || deliveries.length ? [{ ...node, deliveries }] : [];
      });
      return { ...group, roots };
    })
    .filter((group) => group.roots.length > 0);
}
