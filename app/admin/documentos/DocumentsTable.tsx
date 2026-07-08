"use client";

import { useMemo, useState } from "react";
import DocumentPreviewModal from "./DocumentPreviewModal";
import type { AdminDocument } from "@/lib/supabase";
import type { DocumentStatus, DocumentType } from "@/lib/validation";

type ClientLite = { slug: string; name: string };

const TYPE_LABEL: Record<DocumentType, string> = {
  contrato: "Contrato", proposta: "Proposta", relatorio: "Relatório", material: "Material",
};
const STATUS_LABEL: Record<DocumentStatus, string> = {
  enviada: "Enviada", assinado: "Assinado", aguardando_assinatura: "Aguardando assinatura",
  publicado: "Publicado", compartilhado: "Compartilhado",
};
const STATUS_TONE: Record<DocumentStatus, string> = {
  enviada: "blue", assinado: "green", aguardando_assinatura: "red", publicado: "green", compartilhado: "purple",
};
const FILTERS: { key: DocumentType | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "contrato", label: "Contratos" },
  { key: "relatorio", label: "Relatórios" },
  { key: "material", label: "Materiais" },
  { key: "proposta", label: "Propostas" },
];

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[3]} ${MES[Number(m[2]) - 1]} ${m[1]}`;
}

type Draft = {
  id?: string;
  slug: string;
  name: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  file_url: string;
  doc_date: string;
};

export default function DocumentsTable({ initial, clients }: { initial: AdminDocument[]; clients: ClientLite[] }) {
  const [docs, setDocs] = useState<AdminDocument[]>(initial);
  const [filter, setFilter] = useState<DocumentType | "all">("all");
  const [clientFilter, setClientFilter] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewDoc, setPreviewDoc] = useState<AdminDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows = useMemo(
    () => docs.filter((d) => (filter === "all" || d.doc_type === filter) && (!clientFilter || d.clientSlug === clientFilter)),
    [docs, filter, clientFilter],
  );

  function newDoc() {
    setDraft({ slug: clients[0]?.slug ?? "", name: "", doc_type: "contrato", status: "enviada", file_url: "", doc_date: "" });
  }
  function editDoc(d: AdminDocument) {
    setDraft({ id: d.id, slug: d.clientSlug, name: d.name, doc_type: d.doc_type, status: d.status, file_url: d.file_url ?? "", doc_date: d.doc_date ?? "" });
  }

  async function refresh() {
    const res = await fetch("/api/admin/documents");
    if (res.ok) setDocs((await res.json()).documents ?? []);
  }

  async function save() {
    if (!draft || !draft.name.trim() || !draft.slug) return;
    setBusy(true);
    setError("");
    const body = {
      name: draft.name.trim(),
      doc_type: draft.doc_type,
      status: draft.status,
      file_url: draft.file_url.trim() || null,
      doc_date: draft.doc_date.trim() || null,
    };
    try {
      const res = draft.id
        ? await fetch(`/api/admin/documents/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, slug: draft.slug }) });
      if (!res.ok) throw new Error();
      setDraft(null);
      await refresh();
    } catch {
      setError("Não foi possível salvar o documento.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/documents/${draft.id}`, { method: "DELETE" });
      setDraft(null);
      await refresh();
    } catch {
      setError("Não foi possível excluir.");
    }
    setBusy(false);
  }

  return (
    <div className="doc">
      <div className="doc-toolbar">
        <div className="doc-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={`admin-chip ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
          <select className="doc-clientfilter" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">Por cliente · todos</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <button className="admin-btn primary" onClick={newDoc}>↑ Enviar documento</button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead>
            <tr><th>Documento</th><th>Cliente</th><th>Tipo</th><th>Data</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} onClick={() => setPreviewDoc(d)}>
                <td>
                  <span className="doc-name"><span className="doc-ico">PDF</span>{d.name}</span>
                </td>
                <td>
                  <span className="doc-client"><span className="doc-avatar">{initials(d.clientName)}</span>{d.clientName}</span>
                </td>
                <td>{TYPE_LABEL[d.doc_type]}</td>
                <td className="doc-date">{fmtDate(d.doc_date)}</td>
                <td><span className={`doc-status tone-${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span></td>
                <td className="doc-open">
                  <button
                    type="button"
                    className="doc-open-btn"
                    onClick={(e) => { e.stopPropagation(); editDoc(d); }}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="admin-empty" style={{ padding: 28 }}>Nenhum documento nesta visão.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="kb-modal-backdrop" onClick={() => !busy && setDraft(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kb-modal-head">
              <h2>{draft.id ? "Editar documento" : "Enviar documento"}</h2>
              <button className="kb-modal-close" onClick={() => setDraft(null)} aria-label="Fechar">✕</button>
            </div>
            <label className="admin-field"><span>Nome</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus placeholder="Contrato de prestação" />
            </label>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Cliente</span>
                <select value={draft.slug} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, slug: e.target.value })}>
                  {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </label>
              <label className="admin-field"><span>Tipo</span>
                <select value={draft.doc_type} onChange={(e) => setDraft({ ...draft, doc_type: e.target.value as DocumentType })}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Status</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DocumentStatus })}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="admin-field"><span>Data</span>
                <input value={draft.doc_date} onChange={(e) => setDraft({ ...draft, doc_date: e.target.value })} placeholder="2026-06-01" />
              </label>
            </div>
            <label className="admin-field"><span>Link do arquivo (Drive/URL)</span>
              <input value={draft.file_url} onChange={(e) => setDraft({ ...draft, file_url: e.target.value })} placeholder="https://…" />
            </label>
            <div className="kb-modal-actions">
              {draft.id ? <button className="admin-btn ghost danger" onClick={remove} disabled={busy}>Excluir</button> : <span />}
              <div className="kb-modal-actions-right">
                <button className="admin-btn ghost" onClick={() => setDraft(null)} disabled={busy}>Cancelar</button>
                <button className="admin-btn primary" onClick={save} disabled={busy || !draft.name.trim()}>{busy ? "Salvando…" : "Salvar"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewDoc ? (
        <DocumentPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onChanged={(updated) => {
            setPreviewDoc(updated);
            setDocs((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
          }}
        />
      ) : null}
    </div>
  );
}
