"use client";

import { useEffect, useState } from "react";
import { AI_PROVIDER } from "@/lib/aiProviders";
import type { MaskedAiProviderSettings } from "@/lib/supabase";

// Configurações → Integrações: Provedor de IA setup. Same vault-backed
// pattern as WindsorIntegration — the API key is write-only from the
// browser's point of view; GET only ever returns configured/last4.
export default function AiProviderIntegration() {
  const [settings, setSettings] = useState<MaskedAiProviderSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // Ignore a response that arrives after unmount / Strict Mode's dev-only
    // second effect, so a stale request cannot update this screen.
    let cancelled = false;
    fetch("/api/admin/settings/ai-provider")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MaskedAiProviderSettings | null) => {
        if (cancelled) return;
        setSettings(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(patch: Record<string, unknown>, touchesKey = false) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings/ai-provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      const data: MaskedAiProviderSettings = await res.json();
      setSettings(data);
      if (touchesKey) setApiKey("");
      setMsg("Salvo.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
    setBusy(false);
  }

  function saveKey() {
    if (!apiKey.trim()) return;
    void save({ apiKey: apiKey.trim() }, true);
  }

  if (!settings) {
    return (
      <div className="set-card">
        <h2 className="set-h">Provedor de IA</h2>
        <p className="admin-sub">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="set-card">
      <h2 className="set-h">
        Provedor de IA{" "}
        {settings.configured ? <span className="set-badge publicada">Configurado</span> : null}
      </h2>
      <p className="admin-sub">
        OpenAI · GPT é o único provedor habilitado. Informe a chave da API.
        {settings.configured ? " Conectado." : " Sem a chave, as automações de IA não têm acesso a um modelo."}
      </p>

      <div className="set-grid">
        <label className="admin-field">
          <span>Chave da API</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.configured ? `••••••••${settings.apiKeyLast4}` : `Cole a API key da ${AI_PROVIDER.label}`}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="wi-mapping">
        <strong className="set-etapas-label">Modelos disponíveis</strong>
        <p className="admin-sub">Modelos disponíveis para a integração OpenAI.</p>
        {AI_PROVIDER.models.map((m) => (
          <label className="admin-field wi-maprow" key={m}>
            <span>{m}</span>
          </label>
        ))}
      </div>

      <div className="set-actions" style={{ justifyContent: "flex-start", gap: 8 }}>
        {settings.configured ? (
          <button className="admin-btn ghost danger" onClick={() => void save({ clearApiKey: true }, true)} disabled={busy}>
            Remover chave
          </button>
        ) : null}
      </div>

      <div className="set-actions">
        {msg ? <span className="set-msg">{msg}</span> : <span />}
        <button className="admin-btn primary" onClick={saveKey} disabled={busy || !apiKey.trim()}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
