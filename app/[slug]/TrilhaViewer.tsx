"use client";

import { useEffect, useState } from "react";
import type { NorthTrilha } from "@/lib/validation";

// Abre uma trilha (apresentação HTML ou vídeo do YouTube) num overlay que ocupa
// a tela. O Manual do Cliente NÃO passa por aqui — ele tem seu próprio deck
// (ManualDoCliente.tsx).
export default function TrilhaViewer({ trilha, onClose }: { trilha: NorthTrilha; onClose: () => void }) {
  // Trava o scroll do body, igual ao ManualDoCliente / à Overlay da bússola.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="np-trail-viewer" role="dialog" aria-modal="true" aria-label={trilha.title}>
      <div className="np-trail-viewer-top">
        <span className="manual-eyebrow">{trilha.etapa || "Trilhas North"}</span>
        <button className="manual-close" onClick={onClose} aria-label="Fechar">Fechar ✕</button>
      </div>
      <div className="np-trail-viewer-stage">
        {trilha.kind === "video_youtube" && trilha.youtube_id ? (
          <iframe
            src={`https://www.youtube.com/embed/${trilha.youtube_id}?rel=0`}
            title={trilha.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : trilha.kind === "slides_html" && trilha.file_url ? (
          <HtmlFrame url={trilha.file_url} title={trilha.title} />
        ) : (
          <p className="np-doc-empty">Material indisponível.</p>
        )}
      </div>
    </div>
  );
}

// O Storage serve .html como text/plain, então não dá para usar o `src` direto —
// busca o corpo e injeta via `srcDoc` (mesmo truque de DocumentFilePreview).
// `allow-scripts` porque uma apresentação de slides costuma ter JS; sem
// `allow-same-origin` o iframe fica numa origem opaca e não alcança o portal.
function HtmlFrame({ url, title }: { url: string; title: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((text) => { if (!cancelled) setHtml(text); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  if (failed) return <p className="np-doc-empty">Não foi possível carregar a apresentação.</p>;
  if (html === null) return <p className="np-doc-empty">Carregando…</p>;
  return <iframe srcDoc={html} title={title} sandbox="allow-scripts allow-popups allow-forms" />;
}
