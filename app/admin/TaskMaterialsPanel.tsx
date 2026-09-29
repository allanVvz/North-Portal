"use client";

import type { ConversationItem } from "@/lib/cardConversation";

function fileField(item: ConversationItem, key: string): string {
  const value = item.file?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export default function TaskMaterialsPanel({ items, onOpen }: { items: ConversationItem[]; onOpen?: (item: ConversationItem) => void }) {
  const files = items.filter((item) => item.kind === "file");
  if (!files.length) return null;
  return <section className="task-materials-projection" aria-label="Arquivos relacionados">
    <p className="tm-box-label">Arquivos relacionados</p>
    <div className="task-materials-projection-list">
      {files.map((item) => {
        const role = fileField(item, "role") || fileField(item, "file_role") || "document";
        const version = fileField(item, "version_label") || fileField(item, "version_number") || fileField(item, "version") || "";
        const name = fileField(item, "name") || fileField(item, "file_name") || fileField(item, "display_name") || "Arquivo";
        const original = item.file?.sourceDocument && typeof item.file.sourceDocument === "object" ? item.file.sourceDocument as Record<string, unknown> : null;
        const originalName = typeof original?.name === "string" ? original.name : typeof original?.file_name === "string" ? original.file_name : "";
        const source = item.taskTitle || item.path.at(-1) || "Card de origem";
        return <button type="button" className="task-materials-projection-item" key={item.id} onClick={() => onOpen?.(item)}>
          <span aria-hidden>{role === "preview" ? "◉" : role === "final" ? "✓" : "▤"}</span>
          <span><b>{name}</b><small>{source} · {role === "preview" ? "Preview" : role === "final" ? "Final" : "Documento"}{version ? ` · ${version}` : ""}{originalName ? ` · origem: ${originalName}` : ""}</small></span>
          <span aria-hidden>↗</span>
        </button>;
      })}
    </div>
  </section>;
}
