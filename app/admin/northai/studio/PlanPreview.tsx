"use client";

import type { PreviewLine } from "@/lib/northai/blueprint";

// "O que será criado" — agrupado como a pessoa pensa (Compartilhado, Peças,
// Depois da captação), na ordem em que os grupos aparecem.
export default function PlanPreview({ lines, compact = false }: { lines: readonly PreviewLine[]; compact?: boolean }) {
  const groups: { name: string; lines: PreviewLine[] }[] = [];
  for (const line of lines) {
    const name = line.group ?? "";
    const group = groups.find((entry) => entry.name === name);
    if (group) group.lines.push(line);
    else groups.push({ name, lines: [line] });
  }
  return (
    <div className={`nai-preview${compact ? " is-compact" : ""}`}>
      {groups.map((group) => (
        <div className="nai-preview-group" key={group.name || "itens"}>
          {group.name ? <p className="nai-preview-title">{group.name}</p> : null}
          <ul>
            {group.lines.map((line, index) => (
              <li key={index}>
                <span className="nai-preview-ico" aria-hidden>{line.icon}</span>
                <span className="nai-preview-text">
                  <b>{line.text}</b>
                  {line.detail ? <em>{line.detail}</em> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
