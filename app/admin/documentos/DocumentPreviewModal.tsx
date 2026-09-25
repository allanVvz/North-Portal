"use client";

import { useState } from "react";
import type { AdminDocument } from "@/lib/supabase";
import type { DocumentStatus, DocumentType } from "@/lib/validation";
import { fileTypeLabel, formatFileSize } from "@/lib/documentFiles";
import DocumentFilePreview from "@/app/DocumentFilePreview";
import BackArrowIcon from "../BackArrowIcon";

const TYPE_LABEL: Record<DocumentType, string> = {
  contrato: "Contrato", proposta: "Proposta", relatorio: "Relatório", material: "Material",
};
const STATUS_LABEL: Record<DocumentStatus, string> = {
  enviada: "Enviada", assinado: "Assinado", aguardando_assinatura: "Aguardando assinatura",
  publicado: "Publicado", compartilhado: "Compartilhado",
};
// Same tone vocabulary TaskModal uses for its header (tm-head-tone-*).
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

function compactFileType(doc: AdminDocument): string {
  const fileName = doc.original_file_name ?? "";
  const extension = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toUpperCase();
  if (extension) return extension;
  const label = fileTypeLabel(doc);
  return label.length <= 6 ? label : "ARQ";
}

export default function DocumentPreviewModal({
  doc,
  onBack,
  onClose,
  onChanged,
}: {
  doc: AdminDocument;
  // Present only when opened from within a card (TaskModal) — dismisses just
  // this preview, back to that card. Omitted (e.g. from the Documentos
  // table) means there's no "card" to go back to, so no button renders.
  onBack?: () => void;
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
      <div className="tm tm-lg docprev-tm" onClick={(e) => e.stopPropagation()}>
        {onBack ? (
          <button type="button" className="tm-back tm-back-floating" onClick={onBack} aria-label="Voltar para o card" title="Voltar">
            <BackArrowIcon />
          </button>
        ) : null}
        <div className={`tm-head tm-head-tone-${STATUS_TONE[doc.status]}`}>
          <span className="tm-head-ico" aria-hidden>{compactFileType(doc)}</span>
          <div className="tm-head-text">
            <strong className="docprev-title">{doc.name}</strong>
            <span className="admin-sub">{TYPE_LABEL[doc.doc_type]} · {fmtDate(doc.doc_date)}</span>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="tm-layout">
          <div className="tm-main">
            <DocumentFilePreview file={doc} />
          </div>

          <div className="tm-side">
            <div className="tm-box tm-commentsbox docprev-cellbox">
              <p className="tm-box-label">Sobre o arquivo</p>
              <div className="docprev-overview">
                <div className="docprev-overview-row"><span aria-hidden="true">◔</span><strong title={doc.clientName}>{doc.clientName}</strong></div>
                <div className="docprev-overview-row"><span aria-hidden="true">●</span><span className={`doc-status tone-${STATUS_TONE[doc.status]}`}>{STATUS_LABEL[doc.status]}</span></div>
              </div>
              <div className="docprev-file-facts">
                <div title={doc.original_file_name || "Link externo"}><span aria-hidden="true">▤</span><span className="docprev-fact-value">{doc.original_file_name || "Link externo"}</span></div>
                <div title={doc.mime_type || fileTypeLabel(doc)}><span aria-hidden="true">◧</span><span className="docprev-fact-value">{doc.mime_type || fileTypeLabel(doc)}</span></div>
                {doc.size_bytes !== null ? <div><span aria-hidden="true">◈</span><span className="docprev-fact-value">{formatFileSize(doc.size_bytes)}</span></div> : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="kb-modal-actions">
          <span />
          <span />
          <div className="kb-modal-actions-right">
            {doc.file_url ? <a className="admin-btn ghost docprev-action" href={doc.file_url} target="_blank" rel="noopener noreferrer" title="Baixar arquivo"><span aria-hidden="true">↓</span> Baixar</a> : null}
            <button className="admin-btn ghost docprev-action" onClick={share} disabled={!doc.file_url} title="Copiar link do arquivo"><span aria-hidden="true">↗</span> {copied ? "Copiado" : "Compartilhar"}</button>
            <button className="admin-btn primary" onClick={approve} disabled={busy || doc.status === "publicado"}>
              <span aria-hidden="true">✓</span> {doc.status === "publicado" ? "Publicado" : busy ? "Aprovando…" : "Aprovar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
