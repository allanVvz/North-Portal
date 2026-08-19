"use client";

import { useEffect, useState } from "react";
import { documentPreviewKind, fileTypeLabel, formatFileSize } from "@/lib/documentFiles";

type PreviewDocument = {
  file_url: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

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
