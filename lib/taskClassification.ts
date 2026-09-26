import { CANONICAL_DELIVERY_FORMATS } from "./canonicalDeliveryFormats";
import type { TaskTypeDef } from "./taskTypes";
import { subtypeLabel as catalogSubtypeLabel } from "./taskCatalog";

export type TaskBaseTypeKey = "tarefa" | "entrega" | "plano";

export const TASK_BASE_TYPES = [
  { key: "tarefa", label: "Tarefa", kind: "operacional" },
  { key: "entrega", label: "Entrega", kind: "criativo" },
  { key: "plano", label: "Plano", kind: "plano_acao" },
] as const;

let visibleCatalog: readonly TaskTypeDef[] = [];
export function setVisibleTaskTypes(types: readonly TaskTypeDef[]): void { visibleCatalog = types; }

const DELIVERY_LABELS: Record<string, string> = {
  criativo: "Criativo",
  automacao: "Automação",
  ...Object.fromEntries(CANONICAL_DELIVERY_FORMATS.map(({ key, label }) => [key, label])),
};

export type TaskClassification = {
  baseType: TaskBaseTypeKey | "checkpoint";
  baseLabel: string;
  subtypeKey: string | null;
  subtypeLabel: string | null;
  kind: string;
  subtype: string | null;
  behavior: "simples" | "entrega" | "plano";
  workflowVersionId: string | null;
};

export function taskBaseType(kind: string, types: readonly TaskTypeDef[] = []): TaskClassification["baseType"] {
  if (!types.length) types = visibleCatalog;
  if (kind === "plano_acao" || types.find((type) => type.key === kind)?.behavior === "plano") return "plano";
  if (kind === "checkpoint_comercial") return "checkpoint";
  if (DELIVERY_LABELS[kind] || kind.startsWith("entrega_") || types.find((type) => type.key === kind)?.behavior === "entrega") return "entrega";
  return "tarefa";
}

export function classifyTask(kind: string, subtype: string | null = null, types: readonly TaskTypeDef[] = []): TaskClassification {
  if (!types.length) types = visibleCatalog;
  const baseType = taskBaseType(kind, types);
  const type = types.find((candidate) => candidate.key === kind);
  const subtypeKey = baseType === "entrega" ? kind : baseType === "tarefa" ? subtype : null;
  const subtypeLabel = baseType === "entrega"
    ? type?.label ?? DELIVERY_LABELS[kind] ?? kind
    : baseType === "tarefa" && subtype
      ? type?.subtypes.find((candidate) => candidate.key === subtype)?.label ?? catalogSubtypeLabel(subtype)
      : null;
  return {
    baseType,
    baseLabel: baseType === "checkpoint" ? "Checkpoint" : TASK_BASE_TYPES.find((base) => base.key === baseType)!.label,
    subtypeKey,
    subtypeLabel,
    kind,
    subtype,
    behavior: baseType === "entrega" ? "entrega" : baseType === "plano" ? "plano" : "simples",
    workflowVersionId: type?.workflow_version_id ?? null,
  };
}

export function taskClassificationLabel(kind: string, subtype: string | null = null, types: readonly TaskTypeDef[] = []): string {
  const classification = classifyTask(kind, subtype, types);
  return classification.subtypeLabel ? `${classification.baseLabel} · ${classification.subtypeLabel}` : classification.baseLabel;
}

export function deliverySubtypeTypes(types: readonly TaskTypeDef[], currentKind?: string): TaskTypeDef[] {
  return types.filter((type) => type.behavior === "entrega" && (type.active || type.key === currentKind));
}

export function resolveTaskClassification(
  baseType: TaskBaseTypeKey,
  subtypeKey: string | null,
  types: readonly TaskTypeDef[],
): { kind: string; subtype: string | null } | null {
  if (baseType === "plano") return { kind: "plano_acao", subtype: null };
  if (baseType === "tarefa") {
    const task = types.find((type) => type.key === "operacional");
    if (subtypeKey && !task?.subtypes.some((subtype) => subtype.key === subtypeKey)) return null;
    return { kind: "operacional", subtype: subtypeKey };
  }
  const delivery = deliverySubtypeTypes(types).find((type) => type.key === subtypeKey);
  return delivery ? { kind: delivery.key, subtype: null } : null;
}

export function canonicalDeliveryFormat(kind: string): string | null {
  return CANONICAL_DELIVERY_FORMATS.find((format) => format.key === kind)?.label ?? null;
}

export function normalizeDeliveryPayload(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  const format = canonicalDeliveryFormat(kind);
  return format ? { ...payload, formato: format } : payload;
}
