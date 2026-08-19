"use client";

import { useState } from "react";

type AiProvider = "anthropic" | "chatgpt" | "deepseek";

const AI_PROVIDERS: { key: AiProvider; label: string; models: string[] }[] = [
  { key: "anthropic", label: "Anthropic", models: ["Claude Sonnet 5", "Claude Opus 5"] },
  { key: "chatgpt", label: "ChatGPT", models: ["GPT-5", "GPT-5 mini"] },
  { key: "deepseek", label: "DeepSeek", models: ["DeepSeek V4"] },
];

// Configurações → Integrações: mock only. The credential vault's `provider`
// CHECK constraint (public.integration_credentials) doesn't yet allow AI
// providers, so this deliberately does NOT call any save/vault API — it's
// local component state standing in for the real thing until that lands.
export default function AiProviderIntegration() {
  const [provider, setProvider] = useState<AiProvider | "">("");
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);

  const selected = AI_PROVIDERS.find((p) => p.key === provider) ?? null;

  function handleProviderChange(value: string) {
    setProvider(value as AiProvider | "");
    setApiKey("");
    setConnected(false);
  }

  function save() {
    setConnected(true);
  }

  return (
    <div className="set-card">
      <h2 className="set-h">
        Provedor de IA{" "}
        {connected ? <span className="set-badge publicada">Configurado</span> : null}
      </h2>
      <p className="admin-sub">
        Escolha um provedor de IA e informe a chave da API. <span className="admin-soon">em breve</span> — por
        enquanto isso é apenas uma prévia da interface, sem conexão real.
      </p>

      <div className="set-grid">
        <label className="admin-field">
          <span>Provedor</span>
          <select value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
            <option value="">— Selecione —</option>
            {AI_PROVIDERS.map((p) => (
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
                onChange={(e) => { setApiKey(e.target.value); setConnected(false); }}
                placeholder={`Cole a API key da ${selected.label}`}
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

          <div className="set-actions">
            {connected ? <span className="set-msg">Configurado.</span> : <span />}
            <button className="admin-btn primary" onClick={save} disabled={!apiKey.trim()}>
              Salvar
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
