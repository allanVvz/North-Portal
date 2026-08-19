"use client";

import { useEffect, useState } from "react";
import { AI_VENDORS, type AiVendor } from "@/lib/aiProviders";
import type { MaskedAiProviderSettings } from "@/lib/supabase";

// Configurações → Integrações: Provedor de IA setup. Same vault-backed
// pattern as WindsorIntegration — the API key is write-only from the
// browser's point of view; GET only ever returns configured/last4.
export default function AiProviderIntegration() {
  const [settings, setSettings] = useState<MaskedAiProviderSettings | null>(null);
  const [vendor, setVendor] = useState<AiVendor | "">("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // Ignore a response that arrives after the user has already picked a
    // vendor (or after Strict Mode's dev-only double-effect fires this fetch
    // twice) — otherwise a late GET clobbers a fresher selection/save with
    // stale data, silently unmounting the key input + Salvar button under it.
    let cancelled = false;
    fetch("/api/admin/settings/ai-provider")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MaskedAiProviderSettings | null) => {
        if (cancelled) return;
        setSettings(data);
        setVendor(data?.vendor ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = AI_VENDORS.find((p) => p.key === vendor) ?? null;

  // Vendor-only saves (fired the instant the dropdown changes) must NOT
  // touch the apiKey input — that field is edited independently and a slow
  // in-flight vendor save resolving after the user already started typing a
  // key would otherwise wipe it out from under them.
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

  function handleVendorChange(value: string) {
    const next = (value || null) as AiVendor | null;
    setVendor(next ?? "");
    void save({ vendor: next });
  }

  function saveKey() {
    if (!apiKey.trim()) return;
    void save({ apiKey: apiKey.trim(), vendor: vendor || undefined }, true);
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
        Escolha um provedor de IA e informe a chave da API.
        {settings.configured ? " Conectado." : " Sem a chave, as automações de IA não têm acesso a um modelo."}
      </p>

      <div className="set-grid">
        <label className="admin-field">
          <span>Provedor</span>
          <select value={vendor} onChange={(e) => handleVendorChange(e.target.value)} disabled={busy}>
            <option value="">— Selecione —</option>
            {AI_VENDORS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <>
          <div className="set-grid">
            <label className="admin-field">
              <span>Chave da API</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.configured ? `••••••••${settings.apiKeyLast4}` : `Cole a API key da ${selected.label}`}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="wi-mapping">
            <strong className="set-etapas-label">Modelos disponíveis</strong>
            <p className="admin-sub">Modelos que ficarão disponíveis para uso ao configurar esta integração.</p>
            {selected.models.map((m) => (
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
        </>
      ) : null}
    </div>
  );
}
