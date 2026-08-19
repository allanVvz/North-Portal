"use client";

import { useState } from "react";
import type { AdminDocument } from "@/lib/supabase";
import type { DocumentStatus, DocumentType } from "@/lib/validation";
import { fileTypeLabel, formatFileSize } from "@/lib/documentFiles";
import DocumentFilePreview from "@/app/DocumentFilePreview";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[3]} ${MES[Number(m[2]) - 1]} ${m[1]}`;
}

export default function DocumentPreviewModal({
  doc,
  onClose,
  onChanged,
}: {
  doc: AdminDocument;
  onClose: () => void;
  onChanged: (updated: AdminDocument) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function approve() {
    if (doc.status === "publicado") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "publicado" }),
      });
      if (res.ok) onChanged({ ...doc, ...(await res.json()) });
    } catch { /* status stays as-is; user can retry */ }
    setBusy(false);
  }

  function share() {
    if (!doc.file_url) return;
    navigator.clipboard?.writeText(doc.file_url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    });
  }

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="docprev" onClick={(e) => e.stopPropagation()}>
        <div className="docprev-head">
          <span className="doc-ico docprev-ico">{fileTypeLabel(doc)}</span>
          <div className="docprev-headtext">
            <strong>{doc.name}</strong>
            <span className="admin-sub">{TYPE_LABEL[doc.doc_type]} · {fmtDate(doc.doc_date)}</span>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="docprev-body">
          <DocumentFilePreview file={doc} />

          <div className="docprev-details">
            <p className="docprev-details-head">Detalhes</p>
            <div className="docprev-row"><span>Tipo</span><b>{TYPE_LABEL[doc.doc_type]}</b></div>
            <div className="docprev-row"><span>Cliente</span><b>{doc.clientName}</b></div>
            <div className="docprev-row"><span>Status</span><span className={`doc-status tone-${STATUS_TONE[doc.status]}`}>{STATUS_LABEL[doc.status]}</span></div>
            <div className="docprev-row"><span>Data</span><b>{fmtDate(doc.doc_date)}</b></div>
            <div className="docprev-row"><span>Arquivo</span><b>{doc.original_file_name || "Link externo"}</b></div>
            <div className="docprev-row"><span>Formato</span><b>{doc.mime_type || fileTypeLabel(doc)}</b></div>
            {doc.size_bytes !== null ? <div className="docprev-row"><span>Tamanho</span><b>{formatFileSize(doc.size_bytes)}</b></div> : null}
          </div>
        </div>

        <div className="docprev-foot">
          <div className="docprev-foot-left">
            {doc.file_url ? <a className="admin-btn ghost" href={doc.file_url} target="_blank" rel="noopener noreferrer">↓ Baixar</a> : null}
            <button className="admin-btn ghost" onClick={share} disabled={!doc.file_url}>{copied ? "Link copiado ✓" : "Compartilhar"}</button>
          </div>
          <button className="admin-btn primary" onClick={approve} disabled={busy || doc.status === "publicado"}>
            {doc.status === "publicado" ? "Publicado ✓" : busy ? "Aprovando…" : "Aprovar documento"}
          </button>
        </div>
      </div>
    </div>
  );
}
