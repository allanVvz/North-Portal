"use client";

import { useEffect, useState } from "react";
import type { DriveFolderIds } from "@/lib/supabase";
import { driveFileKind, type DriveFile } from "@/lib/googleDrive";

// Read-only version of the Drive folder previews used in the editor: on the
// "Ver cliente" dashboard the admin wants to see whether material actually
// exists, not to edit links.

const KIND_ICON: Record<ReturnType<typeof driveFileKind>, string> = {
  image: "▣",
  video: "▶",
  doc: "▤",
  sheet: "▦",
  slide: "▧",
  pdf: "▤",
  other: "▨",
};

function Folder({ label, folderId, url }: { label: string; folderId: string | null; url: string | null }) {
  const [files, setFiles] = useState<DriveFile[] | null>(folderId ? null : []);

  useEffect(() => {
    if (!folderId) return;
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/admin/drive/files?folderId=${encodeURIComponent(folderId)}`);
      if (!alive) return;
      if (!res.ok) {
        setFiles([]);
        return;
      }
      const data = (await res.json()) as { files?: DriveFile[] };
      if (alive) setFiles(data.files ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [folderId]);

  return (
    <div className="drive-folder">
      <div className="drive-folder-head">
        <strong>{label}</strong>
        <span className={`admin-pill ${folderId ? "on" : "muted"}`}>
          {folderId ? "Sincronizado" : "Manual"}
        </span>
        {url ? (
          <a className="admin-btn ghost" href={url} target="_blank" rel="noreferrer">
            Abrir ↗
          </a>
        ) : null}
      </div>
      {!folderId ? (
        <p className="admin-hint">{url ? "Pasta vinculada manualmente — preview indisponível." : "Nenhuma pasta vinculada."}</p>
      ) : files === null ? (
        <p className="admin-hint">Carregando…</p>
      ) : files.length === 0 ? (
        <p className="admin-hint">Pasta vazia.</p>
      ) : (
        <div className="drive-thumbs">
          {files.slice(0, 4).map((f) => (
            <a key={f.id} className="drive-thumb" href={f.webViewLink ?? undefined} target="_blank" rel="noreferrer" title={f.name}>
              <span className="drive-thumb-box" aria-hidden="true">
                {f.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  KIND_ICON[driveFileKind(f.mimeType)]
                )}
              </span>
              <span className="drive-thumb-name">{f.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DriveFolderPreviews({
  folders,
  links,
}: {
  folders: DriveFolderIds;
  links: { brandUrl: string | null; productsUrl: string | null; uploadsUrl: string | null };
}) {
  return (
    <div className="admin-card">
      <div className="home-card-head">
        <p className="admin-card-title">Pastas do Drive</p>
        {folders.syncedAt ? (
          <span className="admin-hint">sincronizado {new Date(folders.syncedAt).toLocaleString("pt-BR")}</span>
        ) : null}
      </div>
      <div className="visao-drive">
        <Folder label="Marca" folderId={folders.brandFolderId} url={links.brandUrl} />
        <Folder label="Arquivos" folderId={folders.productsFolderId} url={links.productsUrl} />
        <Folder label="Edição" folderId={folders.uploadsFolderId} url={links.uploadsUrl} />
      </div>
    </div>
  );
}
