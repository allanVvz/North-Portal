"use client";

import { useEffect, useState } from "react";
import { WINDSOR_DATASOURCES, type WindsorAccountRef, type WindsorDatasource } from "@/lib/windsor";
import type { MaskedWindsorSettings } from "@/lib/supabase";

type ClientLite = { slug: string; name: string };
type TestedAccount = WindsorAccountRef & { datasource: WindsorDatasource };

// Configurações → Integrações: Windsor.ai (Meta) setup. The API key is
// write-only from the browser's point of view — GET only ever returns
// configured/last4, and the input starts empty (placeholder shows ••••last4).
export default function WindsorIntegration({ clients }: { clients: ClientLite[] }) {
  const [settings, setSettings] = useState<MaskedWindsorSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [accounts, setAccounts] = useState<TestedAccount[]>([]);
  const [testMsg, setTestMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings/windsor")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MaskedWindsorSettings | null) => setSettings(data))
      .catch(() => {});
  }, []);

  async function testConnection() {
    setTesting(true);
    setTestMsg("");
    try {
      const res = await fetch("/api/admin/settings/windsor/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyInput.trim() ? { apiKey: keyInput.trim() } : {}),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAccounts(data.accounts ?? []);
        setTestMsg(`✓ Conectado — ${data.accounts?.length ?? 0} conta${(data.accounts?.length ?? 0) === 1 ? "" : "s"} encontrada${(data.accounts?.length ?? 0) === 1 ? "" : "s"}.`);
      } else {
        setAccounts([]);
        setTestMsg(data.error ?? "Falha ao testar a conexão.");
      }
    } catch {
      setTestMsg("Falha ao testar a conexão.");
    }
    setTesting(false);
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings/windsor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      setSettings(await res.json());
      setKeyInput("");
      setMsg("Salvo.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
    setBusy(false);
  }

  function saveAll() {
    const patch: Record<string, unknown> = {};
    if (keyInput.trim()) patch.apiKey = keyInput.trim();
    void save(patch);
  }

  function setDatasource(ds: WindsorDatasource, on: boolean) {
    if (!settings) return;
    const next = { ...settings.datasources, [ds]: on };
    setSettings({ ...settings, datasources: next });
    void save({ datasources: { [ds]: on } });
  }

  function mapClient(slug: string, value: string) {
    if (!settings || value === "__keep__") return;
    const account = accounts.find((a) => `${a.datasource}:${a.accountId}` === value) ?? null;
    const ref = account ? { accountId: account.accountId, accountName: account.accountName } : null;
    const nextMap = { ...settings.accountMap, [slug]: ref };
    setSettings({ ...settings, accountMap: nextMap });
    void save({ accountMap: nextMap });
  }

  if (!settings) {
    return (
      <div className="set-card">
        <h2 className="set-h">Integrações</h2>
        <p className="admin-sub">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Meta (Instagram/Facebook) via Windsor.ai</h2>
      <p className="admin-sub">
        Conecta o dashboard de Performance aos dados reais das contas Meta. Crie uma conta em windsor.ai,
        conecte as fontes Meta lá e cole a chave da API aqui.
        {settings.configured ? " Conectado." : " Sem a chave, o dashboard mostra dados de demonstração."}
      </p>

      <div className="set-grid">
        <label className="admin-field"><span>Chave da API</span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={settings.configured ? `••••••••${settings.apiKeyLast4}` : "Cole a API key da Windsor"}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="set-actions" style={{ justifyContent: "flex-start", gap: 8 }}>
        <button className="admin-btn ghost" onClick={testConnection} disabled={testing || (!keyInput.trim() && !settings.configured)}>
          {testing ? "Testando…" : "Testar conexão"}
        </button>
        {settings.configured ? (
          <button className="admin-btn ghost danger" onClick={() => void save({ clearApiKey: true })} disabled={busy}>
            Remover chave
          </button>
        ) : null}
        {testMsg ? <span className="set-msg">{testMsg}</span> : null}
      </div>

      <div className="wi-datasources">
        <strong className="set-etapas-label">Fontes de dados</strong>
        {WINDSOR_DATASOURCES.map((ds) => (
          <label className="admin-toggle" key={ds.key}>
            <input
              type="checkbox"
              checked={settings.datasources[ds.key]}
              onChange={(e) => setDatasource(ds.key, e.target.checked)}
            />
            <span className="sw" /><span>{ds.label}</span>
          </label>
        ))}
      </div>

      <div className="wi-mapping">
        <strong className="set-etapas-label">Contas por cliente</strong>
        <p className="admin-sub">Vincule cada cliente à conta Meta correspondente na Windsor. Use "Testar conexão" para carregar as contas.</p>
        {clients.map((c) => {
          const current = settings.accountMap[c.slug];
          const currentValue = current
            ? (accounts.find((a) => a.accountId === current.accountId)
                ? `${accounts.find((a) => a.accountId === current.accountId)!.datasource}:${current.accountId}`
                : "__keep__")
            : "";
          return (
            <label className="admin-field wi-maprow" key={c.slug}>
              <span>{c.name}</span>
              <select value={currentValue} onChange={(e) => mapClient(c.slug, e.target.value)} disabled={busy}>
                <option value="">— Sem conta vinculada —</option>
                {current && currentValue === "__keep__" ? (
                  <option value="__keep__">{current.accountName} (vinculada)</option>
                ) : null}
                {accounts.map((a) => (
                  <option key={`${a.datasource}:${a.accountId}`} value={`${a.datasource}:${a.accountId}`}>
                    {a.accountName} · {a.datasource === "instagram_organic" ? "Instagram" : a.datasource === "facebook_organic" ? "Facebook" : "Facebook Ads"}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <div className="set-actions">
        {msg ? <span className="set-msg">{msg}</span> : <span />}
        <button className="admin-btn primary" onClick={saveAll} disabled={busy || !keyInput.trim()}>
          {busy ? "Salvando…" : "Salvar chave"}
        </button>
      </div>
    </div>
  );
}
