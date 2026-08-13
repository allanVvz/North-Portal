"use client";

import { useEffect, useState } from "react";
import type { MaskedMetaSettings } from "@/lib/supabase";
import MetaConnectModal from "./MetaConnectModal";

type ClientLite = { slug: string; name: string };

// Configurações → Integrações: real Meta (Facebook Login for Business) OAuth
// connection. Separate from WindsorIntegration — that one talks to Windsor.ai
// (which itself proxies Meta data); this one is a direct, official Meta login.
export default function MetaIntegration({ clients }: { clients: ClientLite[] }) {
  const [settings, setSettings] = useState<MaskedMetaSettings | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetch("/api/admin/integrations/meta")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MaskedMetaSettings | null) => setSettings(data))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "meta") setMsg("Conectado com a Meta.");
    if (params.get("metaError")) setMsg("Não foi possível concluir a conexão com a Meta.");
  }, []);

  async function disconnect() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/integrations/meta", { method: "DELETE" });
      if (!res.ok) throw new Error();
      load();
      setMsg("Desconectado.");
    } catch {
      setMsg("Não foi possível desconectar.");
    }
    setBusy(false);
  }

  async function mapClient(slug: string, accountId: string) {
    if (!settings) return;
    const account = settings.adAccounts.find((a) => a.accountId === accountId) ?? null;
    const nextMap = { ...settings.accountMap, [slug]: account };
    setSettings({ ...settings, accountMap: nextMap });
    setBusy(true);
    try {
      const res = await fetch("/api/admin/integrations/meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountMap: nextMap }),
      });
      if (res.ok) setSettings(await res.json());
      else setMsg("Não foi possível salvar o mapeamento.");
    } catch {
      setMsg("Não foi possível salvar o mapeamento.");
    }
    setBusy(false);
  }

  if (!settings) {
    return (
      <div className="set-card">
        <h2 className="set-h">Meta Ads (conexão direta)</h2>
        <p className="admin-sub">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Meta Ads (conexão direta)</h2>
      <p className="admin-sub">
        Autenticação oficial com a Meta (Facebook Login for Business) — acesso real às contas de anúncio, separado da
        Windsor.ai.{" "}
        {settings.configured ? `Conectado como ${settings.businessName}.` : "Nenhuma conta conectada ainda."}
      </p>

      <div className="set-actions" style={{ justifyContent: "flex-start", gap: 8 }}>
        {settings.configured ? (
          <button className="admin-btn ghost danger" onClick={disconnect} disabled={busy}>
            {busy ? "Desconectando…" : "Desconectar"}
          </button>
        ) : (
          <button className="admin-btn primary" onClick={() => setShowConnect(true)}>
            Conectar com a Meta
          </button>
        )}
        {settings.status === "expired" ? <span className="set-msg">Conexão expirada — reconecte.</span> : null}
        {msg ? <span className="set-msg">{msg}</span> : null}
      </div>

      {settings.configured ? (
        <div className="wi-mapping">
          <strong className="set-etapas-label">Contas por cliente</strong>
          <p className="admin-sub">Vincule cada cliente à conta de anúncio Meta correspondente.</p>
          {clients.map((c) => {
            const current = settings.accountMap[c.slug];
            return (
              <label className="admin-field wi-maprow" key={c.slug}>
                <span>{c.name}</span>
                <select value={current?.accountId ?? ""} onChange={(e) => mapClient(c.slug, e.target.value)} disabled={busy}>
                  <option value="">— Sem conta vinculada —</option>
                  {settings.adAccounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>{a.accountName}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : null}

      {showConnect ? <MetaConnectModal onClose={() => { setShowConnect(false); load(); }} /> : null}
    </div>
  );
}
