"use client";

import { kindIcon, kindLabel, kindTone, publicationFormatSubtype, subtypeIcon, subtypeLabel } from "@/lib/taskCatalog";
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
  const visibleSubtype = subtype ?? (kind === "criativo" ? publicationFormatSubtype(format) : null);
  const icon = subtypeIcon(visibleSubtype) ?? kindIcon(kind);
  const label = visibleSubtype && subtypeIcon(visibleSubtype) ? `${kindLabel(kind)} · ${subtypeLabel(visibleSubtype)}` : kindLabel(kind);
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
