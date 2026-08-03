import { kindIcon, kindLabel, kindTone } from "@/lib/taskCatalog";

export default function TaskKindIcon({ kind, size = "md", className = "" }: { kind: string; size?: "sm" | "md" | "lg"; className?: string }) {
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
