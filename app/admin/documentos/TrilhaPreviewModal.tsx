"use client";

import DocumentFilePreview from "@/app/DocumentFilePreview";
import ManualDoCliente from "@/app/[slug]/ManualDoCliente";
import type { NorthTrilha } from "@/lib/validation";

const KIND_ICON: Record<NorthTrilha["kind"], string> = {
  manual: "◆",
  slides_html: "▤",
  video_youtube: "▶",
};
const KIND_LABEL: Record<NorthTrilha["kind"], string> = {
  manual: "Manual do Cliente",
  slides_html: "Apresentação",
  video_youtube: "Vídeo",
};

function ordinal(n: number): string {
  return `${n}ª`;
}

// Abre uma trilha embutida num modal do estilo "card de documento"
// (DocumentPreviewModal): conteúdo na área principal, definição na lateral.
// Manual → o deck de 11 slides em previewMode; HTML → o iframe da apresentação;
// vídeo → o embed do YouTube.
export default function TrilhaPreviewModal({
  trilha,
  positionInQueue,
  onClose,
  onEdit,
}: {
  trilha: NorthTrilha;
  positionInQueue: number;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="tm tm-lg docprev-tm" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head tm-head-tone-blue">
          <span className="tm-head-ico" aria-hidden>{KIND_ICON[trilha.kind]}</span>
          <div className="tm-head-text">
            <strong className="docprev-title">{trilha.title}</strong>
            <span className="admin-sub">
              {KIND_LABEL[trilha.kind]}{trilha.etapa ? ` · ${trilha.etapa}` : ""}
            </span>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="tm-layout">
          <div className="tm-main">
            {trilha.kind === "manual" ? (
              <div className="trilha-preview-embed trilha-preview-manual">
                <ManualDoCliente previewMode onClose={onClose} clientName="cliente" />
              </div>
            ) : trilha.kind === "video_youtube" && trilha.youtube_id ? (
              <div className="trilha-preview-embed">
                <iframe
                  src={`https://www.youtube.com/embed/${trilha.youtube_id}?rel=0`}
                  title={trilha.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : trilha.kind === "slides_html" && trilha.file_url ? (
              <DocumentFilePreview
                file={{
                  file_url: trilha.file_url,
                  original_file_name: `${trilha.title}.html`,
                  mime_type: "text/html",
                  size_bytes: null,
                }}
              />
            ) : (
              <p className="admin-empty">Conteúdo indisponível.</p>
            )}
          </div>

          <div className="tm-side">
            <div className="tm-box tm-commentsbox docprev-cellbox">
              <p className="tm-box-label">Definição</p>
              <div className="docprev-cells">
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◆</span><div className="tm-cell-body"><span className="tm-cell-label">Tipo</span><span className="tm-cell-static">{KIND_LABEL[trilha.kind]}</span></div></div>
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>▦</span><div className="tm-cell-body"><span className="tm-cell-label">Posição na fila</span><span className="tm-cell-static">{ordinal(positionInQueue)}</span></div></div>
                {trilha.etapa ? (
                  <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>⚑</span><div className="tm-cell-body"><span className="tm-cell-label">Etapa</span><span className="tm-cell-static">{trilha.etapa}</span></div></div>
                ) : null}
                <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>✎</span><div className="tm-cell-body"><span className="tm-cell-label">Descrição</span><span className="tm-cell-static docprev-cell-wrap">{trilha.description || "—"}</span></div></div>
                {trilha.kind === "slides_html" ? (
                  <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>▤</span><div className="tm-cell-body"><span className="tm-cell-label">Arquivo</span><span className="tm-cell-static docprev-cell-wrap">apresentação HTML</span></div></div>
                ) : null}
                {trilha.kind === "video_youtube" ? (
                  <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>▶</span><div className="tm-cell-body"><span className="tm-cell-label">YouTube</span><span className="tm-cell-static docprev-cell-wrap">{trilha.youtube_id}</span></div></div>
                ) : null}
                {trilha.kind === "manual" ? (
                  <div className="tm-cell"><span className="tm-cell-ico" aria-hidden>◈</span><div className="tm-cell-body"><span className="tm-cell-label">Conteúdo</span><span className="tm-cell-static docprev-cell-wrap">11 slides fixos da plataforma</span></div></div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <footer className="kb-modal-actions">
          <span />
          <span />
          <div className="kb-modal-actions-right">
            {trilha.kind === "slides_html" && trilha.file_url ? (
              <a className="admin-btn ghost" href={trilha.file_url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>
            ) : null}
            {trilha.kind === "video_youtube" && trilha.youtube_id ? (
              <a className="admin-btn ghost" href={`https://www.youtube.com/watch?v=${trilha.youtube_id}`} target="_blank" rel="noopener noreferrer">Abrir no YouTube</a>
            ) : null}
            <button className="admin-btn primary" onClick={onEdit}>Editar metadados</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
