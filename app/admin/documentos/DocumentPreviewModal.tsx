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
          <span className="tm-head-ico" aria-hidden>{fileTypeLabel(doc)}</span>
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
              <p className="tm-box-label">Detalhes</p>
              <div className="docprev-cells">
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◆</span><div className="tm-cell-body"><span className="tm-cell-label">Tipo</span><span className="tm-cell-static">{TYPE_LABEL[doc.doc_type]}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◔</span><div className="tm-cell-body"><span className="tm-cell-label">Cliente</span><span className="tm-cell-static">{doc.clientName}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>⚑</span><div className="tm-cell-body"><span className="tm-cell-label">Status</span><span className={`doc-status tone-${STATUS_TONE[doc.status]}`}>{STATUS_LABEL[doc.status]}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>▦</span><div className="tm-cell-body"><span className="tm-cell-label">Data</span><span className="tm-cell-static">{fmtDate(doc.doc_date)}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>▤</span><div className="tm-cell-body"><span className="tm-cell-label">Arquivo</span><span className="tm-cell-static docprev-cell-wrap">{doc.original_file_name || "Link externo"}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◧</span><div className="tm-cell-body"><span className="tm-cell-label">Formato</span><span className="tm-cell-static">{doc.mime_type || fileTypeLabel(doc)}</span></div></div>
                {doc.size_bytes !== null ? (
                  <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◈</span><div className="tm-cell-body"><span className="tm-cell-label">Tamanho</span><span className="tm-cell-static">{formatFileSize(doc.size_bytes)}</span></div></div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="kb-modal-actions">
          <span />
          <span />
          <div className="kb-modal-actions-right">
            {doc.file_url ? <a className="admin-btn ghost" href={doc.file_url} target="_blank" rel="noopener noreferrer">↓ Baixar</a> : null}
            <button className="admin-btn ghost" onClick={share} disabled={!doc.file_url}>{copied ? "Link copiado ✓" : "Compartilhar"}</button>
            <button className="admin-btn primary" onClick={approve} disabled={busy || doc.status === "publicado"}>
              {doc.status === "publicado" ? "Publicado ✓" : busy ? "Aprovando…" : "Aprovar documento"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
