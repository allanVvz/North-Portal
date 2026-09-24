"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GOOGLE_DRIVE_KIND_LABEL, type GoogleDriveLink } from "@/lib/googleDrive";
import BackArrowIcon from "@/app/admin/BackArrowIcon";

const folderEmbed = (id: string) => `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}#grid`;

/** A comment stays short; the Google iframe is created only when requested. */
export default function GoogleDrivePreview({ link, url, onLinkClick }: { link: GoogleDriveLink; url?: string; onLinkClick?: (url: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [resolvedKind, setResolvedKind] = useState<"file" | "folder" | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const ambiguous = link.kind === "file" && Boolean(url) && /[?&]id=/.test(url ?? "");
  const isFolder = resolvedKind ? resolvedKind === "folder" : link.kind === "folder";

  useEffect(() => { setOpen(false); setResolvedKind(null); setImageFailed(false); }, [link.id]);

  useEffect(() => {
    if (!open || !ambiguous || resolvedKind) return;
    let alive = true;
    void fetch(`/api/admin/drive/kind?id=${encodeURIComponent(link.id)}`)
      .then(async (response) => response.ok ? await response.json() as { kind?: string } : null)
      .then((result) => { if (alive) setResolvedKind(result?.kind === "folder" ? "folder" : "file"); })
      .catch(() => { if (alive) setResolvedKind("file"); });
    return () => { alive = false; };
  }, [open, ambiguous, resolvedKind, link.id]);

  const label = isFolder ? "Pasta do Drive" : GOOGLE_DRIVE_KIND_LABEL[link.kind];
  const src = isFolder ? folderEmbed(link.id) : link.embedUrl;
  const pending = ambiguous && !resolvedKind;

  return <>
    <button type="button" className="gdrive-comment-attachment" onClick={() => { if (!url || !onLinkClick?.(url)) setOpen(true); }} aria-label={`Visualizar ${label} do comentário`}>
      <span className="gdrive-comment-attachment-thumb">
        {link.kind === "file" && !ambiguous && !imageFailed ? <img src={`/api/admin/drive/thumbnail/${encodeURIComponent(link.id)}`} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : null}
        <span aria-hidden>{isFolder ? "▣" : "▧"}</span>
      </span>
      <span><b>{label}</b><small>Toque para ampliar</small></span>
    </button>
    {open ? createPortal(<div className="kb-modal-backdrop" onClick={() => setOpen(false)}><div className="tm tm-lg docprev-tm gdrive-link-modal" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="tm-back tm-back-floating" onClick={() => setOpen(false)} aria-label="Voltar para o card"><BackArrowIcon /></button>
      <div className="tm-head tm-head-tone-purple"><span className="tm-head-ico" aria-hidden>▧</span><div className="tm-head-text"><strong className="docprev-title">{label}</strong><span className="admin-sub">Link citado no comentário</span></div><button type="button" className="kb-modal-close" onClick={() => setOpen(false)} aria-label="Fechar">✕</button></div>
      <div className="tm-layout"><div className="tm-main gdrive-link-modal-main">{pending ? <p className="admin-sub">Abrindo prévia…</p> : <iframe key={src} src={src} title={label} />}</div><aside className="tm-side"><div className="tm-box docprev-cellbox"><p className="tm-box-label">Origem</p><a href={url ?? link.embedUrl} target="_blank" rel="noreferrer">Abrir no Drive ↗</a></div></aside></div>
    </div></div>, document.body) : null}
  </>;
}
