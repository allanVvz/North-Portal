"use client";

import { useState } from "react";
import { GOOGLE_DRIVE_KIND_LABEL, type GoogleDriveLink } from "@/lib/googleDrive";

// Inline preview for a Google Drive/Docs/Sheets/Slides link found in a task
// description or comment (see CommentText's showLinkPreview). Renders
// Google's own `/preview` iframe — the same one "Compartilhar > Incorporar"
// produces — so it only needs the link to already be shared "Qualquer
// pessoa com o link"; no Drive API/OAuth wiring involved.
export default function GoogleDrivePreview({ link }: { link: GoogleDriveLink }) {
  const [loading, setLoading] = useState(true);
  return (
    <span className="gdrive-preview" contentEditable={false}>
      {loading ? <span className="gdrive-preview-loading">Carregando prévia…</span> : null}
      <iframe
        src={link.embedUrl}
        title={GOOGLE_DRIVE_KIND_LABEL[link.kind]}
        loading="lazy"
        onLoad={() => setLoading(false)}
      />
    </span>
  );
}
