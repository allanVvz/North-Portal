"use client";

import { kindIcon, kindTone, subtypeIcon, subtypeLabel } from "@/lib/taskCatalog";
import { classifyTask } from "@/lib/taskClassification";
import { useLiveKindsVersion } from "@/lib/taskCatalog/useLiveKindsVersion";

/** `subtype` é opcional e só troca o GLIFO — a cor/tom continua vindo do
 *  `kind` (formatos de publicação não têm tom próprio, herdam o da Entrega
 *  que os contém, igual todo outro subtype). Sem `subtype` ou sem ícone
 *  próprio pra ele, cai no ícone do `kind` como sempre. */
export default function TaskKindIcon({ kind, subtype, format, size = "md", className = "" }: { kind: string; subtype?: string | null; format?: unknown; size?: "sm" | "md" | "lg"; className?: string }) {
  // Só pra re-renderizar assim que o cache de tipos self-service (AdminShell)
  // esquentar — sem isto, um ícone desenhado antes da busca terminar ficaria
  // no fallback genérico até algo NÃO relacionado forçar outro render.
  useLiveKindsVersion();
  const classification = classifyTask(kind, subtype ?? null);
  const visibleSubtype = classification.baseType === "entrega" && kind.startsWith("entrega_") ? kind.slice("entrega_".length) : subtype;
  const icon = subtypeIcon(visibleSubtype) ?? kindIcon(kind);
  const label = `${classification.baseLabel}${classification.subtypeLabel ? ` · ${classification.baseType === "tarefa" ? subtypeLabel(subtype) : classification.subtypeLabel}` : ""}`;
  return (
    <span
      className={`task-kind-icon task-kind-icon-${size} task-kind-tone-${kindTone(kind)} ${className}`.trim()}
      role="img"
      aria-label={`Tipo: ${label}`}
      title={label}
    >
      {icon}
    </span>
  );
}
