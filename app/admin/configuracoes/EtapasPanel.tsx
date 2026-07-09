"use client";

import { useEffect, useState } from "react";
import type { AdminTabsVisibility, ClientFlowFlags } from "@/lib/validation";

type ClientLite = { slug: string; name: string };
type FlowKey = "revisao" | "aprovacao";
type FlowDef = {
  key: FlowKey;
  label: string;
  adminKey: keyof ClientFlowFlags;
  clienteKey: keyof ClientFlowFlags;
  kanbanKey: keyof ClientFlowFlags;
  tabKey: keyof AdminTabsVisibility;
};

const FLOWS: FlowDef[] = [
  { key: "revisao", label: "Revisão", adminKey: "revisaoAdmin", clienteKey: "revisaoCliente", kanbanKey: "revisaoKanban", tabKey: "revisoesTabVisible" },
  { key: "aprovacao", label: "Aprovação", adminKey: "aprovacaoAdmin", clienteKey: "aprovacaoCliente", kanbanKey: "aprovacaoKanban", tabKey: "aprovacoesTabVisible" },
];

// Safe hide flow for Revisão/Aprovação. Admin/Cliente/Kanban are per-client
// (Admin-off cascades Cliente-off, clears any assigned revisor/aprovador;
// Kanban alone decides whether the board shows the column, moving stranded
// cards back to "Em produção" when turned off). "Aba no menu" is the odd one
// out — it's a single global switch (not per-client), since the admin nav is
// shared across every client; it's shown here, in the same row, purely so
// the two Revisão/Aprovação controls read as one block, but it applies to
// every client at once, not just the one selected below.
export default function EtapasPanel({ clients }: { clients: ClientLite[] }) {
  const [slug, setSlug] = useState(clients[0]?.slug ?? "");
  const [flags, setFlags] = useState<ClientFlowFlags | null>(null);
  const [tabs, setTabs] = useState<AdminTabsVisibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings/tabs-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AdminTabsVisibility | null) => setTabs(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!slug) { setFlags(null); return; }
    setLoading(true);
    setMsg("");
    fetch(`/api/admin/client/${encodeURIComponent(slug)}/flow-flags`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClientFlowFlags | null) => setFlags(data))
      .catch(() => setFlags(null))
      .finally(() => setLoading(false));
  }, [slug]);

  async function save(patch: Partial<ClientFlowFlags>) {
    if (!slug) return;
    setMsg("");
    const optimistic = flags ? { ...flags, ...patch } : null;
    if (optimistic) setFlags(optimistic);
    try {
      const res = await fetch(`/api/admin/client/${encodeURIComponent(slug)}/flow-flags`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (res.ok) setFlags(await res.json());
      else setMsg("Não foi possível salvar.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
  }

  async function saveTab(patch: Partial<AdminTabsVisibility>) {
    setMsg("");
    const optimistic = tabs ? { ...tabs, ...patch } : null;
    if (optimistic) setTabs(optimistic);
    try {
      const res = await fetch("/api/admin/settings/tabs-visibility", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (res.ok) setTabs(await res.json());
      else setMsg("Não foi possível salvar.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Etapas</h2>
      <p className="admin-sub">Ative ou desative Revisão e Aprovação — por cliente (Admin/Cliente/Coluna) e no menu do admin (global).</p>

      <label className="admin-field set-etapas-client">
        <span>Cliente</span>
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>

      {loading || !tabs ? <p className="admin-sub">Carregando…</p> : null}

      {flags && tabs && !loading ? (
        <div className="set-etapas-list">
          {FLOWS.map((flow) => (
            <div className="set-etapas-row" key={flow.key}>
              <strong className="set-etapas-label">{flow.label}</strong>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  checked={flags[flow.adminKey]}
                  onChange={(e) => save({ [flow.adminKey]: e.target.checked, ...(e.target.checked ? {} : { [flow.clienteKey]: false }) })}
                />
                <span className="sw" /><span>Ativo para Admin</span>
              </label>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  checked={flags[flow.clienteKey]}
                  disabled={!flags[flow.adminKey]}
                  onChange={(e) => save({ [flow.clienteKey]: e.target.checked })}
                />
                <span className="sw" /><span>Ativo para Cliente</span>
              </label>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  checked={flags[flow.kanbanKey]}
                  onChange={(e) => save({ [flow.kanbanKey]: e.target.checked })}
                />
                <span className="sw" /><span>Coluna do Kanban</span>
              </label>
              <label className="admin-toggle set-etapas-tabtoggle">
                <input type="checkbox" checked={tabs[flow.tabKey]} onChange={(e) => saveTab({ [flow.tabKey]: e.target.checked })} />
                <span className="sw" /><span>Aba no menu (global)</span>
              </label>
              <p className="admin-sub set-etapas-note">
                Desativar para Admin remove o {flow.key === "revisao" ? "revisor" : "aprovador"} atribuído e desativa também para o Cliente.
                Desativar a Coluna do Kanban esconde a coluna de {flow.label} do quadro e move os cards que estiverem nela para Em produção — funciona independente dos outros.
                "Aba no menu" não é por cliente: vale para todo mundo que acessa o admin.
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {!slug ? <p className="admin-sub">Nenhum cliente cadastrado.</p> : null}
      {msg ? <span className="set-msg">{msg}</span> : null}
    </div>
  );
}
