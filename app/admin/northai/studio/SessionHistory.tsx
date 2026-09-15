"use client";

import type { ClientLite, StudioMessage } from "./types";

// Conversas recentes por cliente (gaveta). Ficam neste navegador.
export default function SessionHistory({
  clients,
  threads,
  activeClient,
  onPick,
  onClose,
}: {
  clients: readonly ClientLite[];
  threads: Record<string, StudioMessage[]>;
  activeClient: string | null;
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const rows = Object.entries(threads)
    .filter(([, messages]) => messages.length)
    .map(([slug, messages]) => {
      const last = messages[messages.length - 1];
      const text = last.role === "user" ? last.text : last.kind === "text" ? last.text : last.kind === "recipe" ? last.title : "Análise da operação";
      return { slug, name: clients.find((client) => client.slug === slug)?.name ?? slug, at: last.at, text };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="nai-history">
      <div className="nai-context-head">
        <strong>Conversas recentes</strong>
        <button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar conversas">✕</button>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.slug}>
              <button type="button" className={row.slug === activeClient ? "on" : ""} onClick={() => onPick(row.slug)}>
                <strong>{row.name}</strong>
                <span>{row.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nai-muted">As conversas aparecem aqui, uma por cliente.</p>
      )}
      <p className="nai-muted nai-history-foot">Guardadas neste navegador.</p>
    </div>
  );
}
