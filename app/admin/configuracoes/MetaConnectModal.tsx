"use client";

import { useState } from "react";

// Confirmation step before leaving the app for Facebook's real OAuth dialog.
// Full-page redirect (not a popup) — Meta's login dialog is unreliable inside
// iframes/popups due to third-party cookie/frame protections.
export default function MetaConnectModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function connect() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/integrations/meta/connect");
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setErr(data.error ?? "Não foi possível iniciar a conexão.");
    } catch {
      setErr("Não foi possível iniciar a conexão.");
    }
    setBusy(false);
  }

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="metaconnect" onClick={(e) => e.stopPropagation()}>
        <div className="attrcfg-head">
          <div>
            <h2>Conectar com a Meta</h2>
            <p className="admin-sub">Você será levado à tela oficial de login da Meta (Facebook).</p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="metaconnect-body">
          <p className="admin-sub">Esta conexão vai pedir as seguintes permissões na Business Manager do North:</p>
          <ul className="meta-scopes">
            <li><strong>Gerenciar campanhas e anúncios</strong> — <code>ads_management</code></li>
            <li><strong>Ler dados de anúncios</strong> — <code>ads_read</code></li>
            <li><strong>Ler contas de negócio</strong> — <code>business_management</code></li>
            <li><strong>Listar Páginas</strong> — <code>pages_show_list</code></li>
          </ul>
          {err ? <p className="set-msg">{err}</p> : null}
        </div>

        <div className="kb-modal-actions">
          <span />
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="admin-btn primary" onClick={connect} disabled={busy}>
              {busy ? "Redirecionando…" : "Continuar com a Meta"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
