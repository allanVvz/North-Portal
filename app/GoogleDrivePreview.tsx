"use client";

import { useEffect, useState } from "react";
import { GOOGLE_DRIVE_KIND_LABEL, type GoogleDriveLink } from "@/lib/googleDrive";

// Prévia embutida de um link do Drive/Docs/Sheets/Slides citado num comentário
// ou na descrição (ver showLinkPreview em CommentText). Renderiza o iframe do
// próprio Google — o mesmo que "Compartilhar > Incorporar" produz —, então
// basta o link já estar compartilhado como "qualquer pessoa com o link"; não
// há API nem OAuth envolvido.
//
// PASTA vs ARQUIVO. `/open?id=…` é a forma que o Drive para desktop gera e
// serve para os dois; a URL sozinha não distingue, e parseGoogleDriveUrl chuta
// arquivo. Com o chute errado uma pasta virava um iframe de arquivo, que o
// Google responde com erro — era por isso que pasta colada em comentário não
// abria prévia nenhuma.
//
// Agora o componente pergunta ao servidor (/api/admin/drive/kind) quando a URL
// é ambígua, e troca para a visão de pasta se for o caso. A pergunta só sai
// para link ambíguo: `/drive/folders/…` e `/file/d/…` já se declaram na URL.
const FOLDER_EMBED = (id: string) => `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}#grid`;

export default function GoogleDrivePreview({ link, url }: { link: GoogleDriveLink; url?: string }) {
  const [loading, setLoading] = useState(true);
  const [isFolder, setIsFolder] = useState(link.kind === "folder");

  // Ambíguo = veio de `?id=`, que não prova nada. Só esse caso pergunta.
  const ambiguous = link.kind === "file" && Boolean(url) && /[?&]id=/.test(url ?? "");

  useEffect(() => {
    if (!ambiguous) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/drive/kind?id=${encodeURIComponent(link.id)}`);
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { kind?: string };
        if (alive && data.kind === "folder") {
          setIsFolder(true);
          setLoading(true);
        }
      } catch {
        // Sem resposta, segue como arquivo — que é o comportamento anterior.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ambiguous, link.id]);

  const src = isFolder ? FOLDER_EMBED(link.id) : link.embedUrl;

  return (
    <span className={`gdrive-preview${isFolder ? " is-folder" : ""}`} contentEditable={false}>
      {loading ? <span className="gdrive-preview-loading">Carregando prévia…</span> : null}
      <iframe
        // A chave força um iframe novo quando a resposta troca arquivo por
        // pasta: só mudar o src nem sempre dispara o onLoad de novo.
        key={src}
        src={src}
        title={isFolder ? "Pasta do Drive" : GOOGLE_DRIVE_KIND_LABEL[link.kind]}
        loading="lazy"
        onLoad={() => setLoading(false)}
      />
    </span>
  );
}
