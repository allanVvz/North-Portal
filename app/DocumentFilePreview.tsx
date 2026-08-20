"use client";

import { useEffect, useState } from "react";
import { documentPreviewKind, fileTypeLabel, formatFileSize, isHtmlDocument } from "@/lib/documentFiles";

type PreviewDocument = {
  file_url: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

// Supabase Storage always serves .html objects as `Content-Type: text/plain`
// (a stored-XSS mitigation applied at the platform level, not something this
// app's upload can override) — loading that URL as an iframe `src` renders
// the raw markup as text instead of a page. Fetching the bytes and handing
// them to the iframe via `srcDoc` sidesteps the served content-type entirely
// while keeping the same empty `sandbox` (no scripts, no same-origin).
function HtmlDocFrame({ url, title, onLoad, onError }: { url: string; title: string; onLoad: () => void; onError: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((text) => { if (!cancelled) { setHtml(text); onLoad(); } })
      .catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  if (html === null) return null;
  return <iframe srcDoc={html} title={title} sandbox="" />;
}

export default function DocumentFilePreview({ file, compact = false }: { file: PreviewDocument; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(file.file_url));
  const kind = documentPreviewKind(file);

  useEffect(() => {
    setFailed(false);
    setLoading(Boolean(file.file_url));
  }, [file.file_url]);

  if (!file.file_url) return <div className={`file-preview ${compact ? "compact" : ""}`}><div className="file-preview-fallback"><span>ARQ</span><strong>Sem arquivo anexado</strong><p>Este registro é apenas informativo.</p></div></div>;

  const done = () => setLoading(false);
  const fail = () => { setLoading(false); setFailed(true); };
  const media = !failed && kind === "pdf" ? (
    <iframe src={`${file.file_url}#toolbar=1&navpanes=0`} title={`Preview de ${file.original_file_name || "documento PDF"}`} onLoad={done} />
  ) : !failed && kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element -- public Storage URL can contain arbitrary image formats.
    <img src={file.file_url} alt={file.original_file_name || "Preview do arquivo"} onLoad={done} onError={fail} />
  ) : !failed && kind === "video" ? (
    <video src={file.file_url} controls preload="metadata" onLoadedData={done} onError={fail} />
  ) : !failed && kind === "audio" ? (
    <div className="file-preview-audio"><span>{fileTypeLabel(file)}</span><audio src={file.file_url} controls preload="metadata" onLoadedData={done} onError={fail} /></div>
  ) : !failed && kind === "text" && isHtmlDocument(file) ? (
    <HtmlDocFrame url={file.file_url} title={`Preview de ${file.original_file_name || "apresentação HTML"}`} onLoad={done} onError={fail} />
  ) : !failed && kind === "text" ? (
    <iframe src={file.file_url} title={`Preview de ${file.original_file_name || "arquivo de texto"}`} sandbox="" onLoad={done} />
  ) : null;

  return (
    <div className={`file-preview ${compact ? "compact" : ""}`}>
      {loading && media ? <div className="file-preview-loading">Carregando preview…</div> : null}
      {media || (
        <div className="file-preview-fallback">
          <span>{fileTypeLabel(file)}</span>
          <strong>{file.original_file_name || "Arquivo anexado"}</strong>
          <p>{failed ? "Não foi possível carregar o preview." : "Este formato não possui preview no navegador."}</p>
          {file.size_bytes !== null ? <small>{formatFileSize(file.size_bytes)}</small> : null}
        </div>
      )}
    </div>
  );
}
