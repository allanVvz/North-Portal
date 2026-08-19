"use client";

import { useState } from "react";

// Configurações → Integrações: mock only. The credential vault's `provider`
// CHECK constraint (public.integration_credentials) doesn't yet allow
// 'google_drive', so this deliberately does NOT call any save/vault API or
// real OAuth — it's local component state standing in for the real thing
// (inline preview of a connected Drive folder's images/videos on cards).
export default function DriveIntegration() {
  const [connected, setConnected] = useState(false);

  function connect() {
    setConnected(true);
  }

  function disconnect() {
    setConnected(false);
  }

  return (
    <div className="set-card">
      <h2 className="set-h">
        Google Drive{" "}
        {connected ? <span className="set-badge publicada">Configurado</span> : null}
      </h2>
      <p className="admin-sub">
        Conecte uma pasta do Google Drive para exibir prévias de imagens e vídeos direto nos cards.{" "}
        <span className="admin-soon">em breve</span> — por enquanto isso é apenas uma prévia da interface, sem
        conexão real.
      </p>

      <div className="set-actions" style={{ justifyContent: "flex-start", gap: 8 }}>
        {connected ? (
          <button className="admin-btn ghost danger" onClick={disconnect}>
            Desconectar
          </button>
        ) : (
          <button className="admin-btn primary" onClick={connect}>
            Conectar Google Drive
          </button>
        )}
      </div>

      {connected ? (
        <div
          className="admin-empty"
          style={{ marginTop: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          </svg>
          <p>Pré-visualização de imagens/vídeos da pasta conectada aparecerá aqui.</p>
        </div>
      ) : null}
    </div>
  );
}
