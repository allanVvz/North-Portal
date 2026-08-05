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
  tabKey: keyof AdminTabsVisibility;
};

const FLOWS: FlowDef[] = [
  { key: "revisao", label: "Revisão", adminKey: "revisaoAdmin", clienteKey: "revisaoCliente", tabKey: "revisoesTabVisible" },
  { key: "aprovacao", label: "Aprovação", adminKey: "aprovacaoAdmin", clienteKey: "aprovacaoCliente", tabKey: "aprovacoesTabVisible" },
];

// Safe hide flow for Revisão/Aprovação — just 2 toggles per client (Admin,
// Cliente; admin-off cascades cliente-off, clears any assigned
// revisor/aprovador, and moves stranded cards back to "Em produção") plus 2
// global toggles shown once below (not per client) for whether the
// Revisões/Aprovações tabs even exist in the admin nav. The Kanban column
// itself has no toggle at all — it's automatic, visible only while at least
// one card actually sits in that stage. "Publicado" is the exception: a
// single global switch (no per-client dimension) since it's not a flow stage
// but a presentation choice: off merges its cards visually into Concluído.
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
      <p className="admin-sub">Ative ou desative Revisão e Aprovação — por cliente (Admin/Cliente) e no menu do admin (global). Ligar "Ativo para Admin" já deixa a coluna do Kanban disponível (mesmo vazia); desligar move os cards dela para Em produção e some com a coluna assim que nenhum outro cliente tiver a etapa ligada.</p>

      {tabs ? (
        <div className="set-etapas-global">
          <strong className="set-etapas-label">Abas no menu (todo o admin)</strong>
          {FLOWS.map((flow) => (
            <label className="admin-toggle" key={flow.key}>
              <input type="checkbox" checked={tabs[flow.tabKey]} onChange={(e) => saveTab({ [flow.tabKey]: e.target.checked })} />
              <span className="sw" /><span>{flow.label}</span>
            </label>
          ))}
        </div>
      ) : null}

      {tabs ? (
        <div className="set-etapas-global">
          <strong className="set-etapas-label">Coluna "Publicado" (Kanban)</strong>
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={tabs.publicadoColumnVisible}
              onChange={(e) => saveTab({ publicadoColumnVisible: e.target.checked })}
            />
            <span className="sw" /><span>Ativa</span>
          </label>
          <p className="admin-sub set-etapas-note">
            Ligada, Concluído e Publicado aparecem em colunas separadas. Desligada, apenas a coluna Publicado some e seus cards são exibidos dentro de Concluído, sem mudar o status; só cards do tipo Criativo podem ser publicados.
          </p>
        </div>
      ) : null}

      <label className="admin-field set-etapas-client">
        <span>Cliente</span>
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>

      {loading ? <p className="admin-sub">Carregando…</p> : null}

      {flags && !loading ? (
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
              <p className="admin-sub set-etapas-note">
                Desativar para Admin remove o {flow.key === "revisao" ? "revisor" : "aprovador"} atribuído, desativa também para o Cliente, e move os cards que estiverem em {flow.label} para Em produção.
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
