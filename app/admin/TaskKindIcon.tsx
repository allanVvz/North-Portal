"use client";

import { kindIcon, kindLabel, kindTone } from "@/lib/taskCatalog";
import { useLiveKindsVersion } from "@/lib/taskCatalog/useLiveKindsVersion";

export default function TaskKindIcon({ kind, size = "md", className = "" }: { kind: string; size?: "sm" | "md" | "lg"; className?: string }) {
  // Só pra re-renderizar assim que o cache de tipos self-service (AdminShell)
  // esquentar — sem isto, um ícone desenhado antes da busca terminar ficaria
  // no fallback genérico até algo NÃO relacionado forçar outro render.
  useLiveKindsVersion();
  return (
    <span
      className={`task-kind-icon task-kind-icon-${size} task-kind-tone-${kindTone(kind)} ${className}`.trim()}
      role="img"
      aria-label={`Tipo: ${kindLabel(kind)}`}
      title={kindLabel(kind)}
    >
      {kindIcon(kind)}
    </span>
  );
}
