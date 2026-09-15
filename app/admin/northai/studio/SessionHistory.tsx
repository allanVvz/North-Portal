"use client";

import { ClientMonogram } from "./ClientIdentity";
import type { ClientLite, StudioMessage } from "./types";

// Conversas recentes por cliente (gaveta). Indexadas pelo id do cliente; ficam
// neste navegador.
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
  onPick: (clientId: string) => void;
  onClose: () => void;
}) {
  const rows = Object.entries(threads)
    .filter(([, messages]) => messages.length)
    .flatMap(([clientId, messages]) => {
      const client = clients.find((entry) => entry.id === clientId);
      if (!client) return [];
      const last = messages[messages.length - 1];
      const text =
        last.role === "user" ? last.text
          : last.kind === "text" || last.kind === "choice" ? last.text
            : last.kind === "recipe" ? last.title
              : "Análise da operação";
      return [{ client, at: last.at, text }];
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="nai-history">
      <div className="nai-inspector-top">
        <span className="nai-section-label">Conversas recentes</span>
        <button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar conversas">✕</button>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.client.id}>
              <button type="button" className={row.client.id === activeClient ? "on" : ""} onClick={() => onPick(row.client.id)}>
                <ClientMonogram client={row.client} size="sm" />
                <span className="nai-history-text">
                  <strong>{row.client.name}</strong>
                  <span>{row.text}</span>
                </span>
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
