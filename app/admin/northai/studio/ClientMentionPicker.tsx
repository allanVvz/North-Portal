"use client";

import { ClientMonogram } from "./ClientIdentity";
import type { ClientLite } from "./types";

// A lista do @cliente. Só desenha: filtro e teclado moram em lib/northai/mentions.ts.
// `placement="up"` abre acima do composer (que fica no rodapé).
export default function ClientMentionPicker({
  id,
  clients,
  activeIndex,
  placement,
  onPick,
  onHover,
  title = "Clientes",
}: {
  id: string;
  clients: readonly ClientLite[];
  activeIndex: number;
  placement: "up" | "down";
  onPick: (client: ClientLite) => void;
  onHover: (index: number) => void;
  title?: string;
}) {
  return (
    <div className={`nai-picker is-${placement}`}>
      <p className="nai-picker-title">{title}</p>
      {clients.length ? (
        <ul id={id} role="listbox" aria-label={title}>
          {clients.map((client, index) => {
            const meta = [client.segment, client.city].filter(Boolean).join(" · ");
            return (
              <li
                key={client.id}
                id={`${id}-${client.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                onMouseEnter={() => onHover(index)}
                // mousedown: escolhe antes do blur do textarea fechar o picker
                onMouseDown={(event) => { event.preventDefault(); onPick(client); }}
              >
                <ClientMonogram client={client} size="sm" />
                <span className="nai-picker-text">
                  <strong>{client.name}</strong>
                  {meta ? <em>{meta}</em> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="nai-picker-empty">Nenhum cliente encontrado.</p>
      )}
    </div>
  );
}
