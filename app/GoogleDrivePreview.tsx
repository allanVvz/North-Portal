"use client";

import { useState } from "react";
import { GOOGLE_DRIVE_KIND_LABEL, type GoogleDriveLink } from "@/lib/googleDrive";

/** Compact comment attachment. The card that owns the link chooses its modal. */
export default function GoogleDrivePreview({ link, url, name, onLinkClick }: {
  link: GoogleDriveLink;
  url?: string;
  name?: string;
  onLinkClick?: (url: string) => boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = name || (link.kind === "folder" ? "Pasta do Drive" : GOOGLE_DRIVE_KIND_LABEL[link.kind]);
  return <a className="gdrive-comment-attachment" href={url ?? link.embedUrl} target="_blank" rel="noopener noreferrer"
    onClick={(event) => { if (url && onLinkClick?.(url)) event.preventDefault(); }}
    aria-label={`Abrir ${label}`}>
    <span className="gdrive-comment-attachment-thumb">
      {link.kind !== "folder" && !imageFailed ? <img src={`/api/admin/drive/thumbnail/${encodeURIComponent(link.id)}`} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : null}
      <span aria-hidden>{link.kind === "folder" ? "▣" : "▧"}</span>
    </span>
    <span><b>{label}</b><small>Abrir material</small></span>
  </a>;
}
