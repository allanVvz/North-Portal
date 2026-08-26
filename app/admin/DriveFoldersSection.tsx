"use client";

import { useEffect, useState } from "react";
import type { DriveFolderIds } from "@/lib/supabase";
import { driveFileKind, type DriveFile } from "@/lib/googleDrive";

// Materiais do cliente. Each folder shows whether it was created by the Drive
// automation or linked by hand, and — when there's a real folder id — a preview
// of what's inside, so the admin doesn't have to open Drive to see if the
// client actually uploaded anything.
//
// driveFileKind is a pure function, safe to import here; the fetching side of
// lib/googleDriveApi only runs behind /api/admin/drive/files.

const KIND_ICON: Record<ReturnType<typeof driveFileKind>, string> = {
  image: "▣",
  video: "▶",
  doc: "▤",
  sheet: "▦",
  slide: "▧",
  pdf: "▤",
  other: "▨",
};

type FolderSpec = {
  label: string;
  folderId: string | null;
  url: string;
  onUrl: (v: string) => void;
};

function FolderPreview({ folderId }: { folderId: string }) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);

  useEffect(() => {
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

  if (files === null) return <p className="admin-hint">Carregando arquivos…</p>;
  if (files.length === 0) return <p className="admin-hint">Nenhum arquivo nesta pasta ainda.</p>;

  return (
    <div className="drive-thumbs">
      {files.slice(0, 8).map((f) => (
        <a
          key={f.id}
          className="drive-thumb"
          href={f.webViewLink ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={f.name}
        >
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
  );
}

export default function DriveFoldersSection({
  folders,
  brandUrl,
  productsUrl,
  uploadsUrl,
  onBrandUrl,
  onProductsUrl,
  onUploadsUrl,
}: {
  folders: DriveFolderIds;
  brandUrl: string;
  productsUrl: string;
  uploadsUrl: string;
  onBrandUrl: (v: string) => void;
  onProductsUrl: (v: string) => void;
  onUploadsUrl: (v: string) => void;
}) {
  const specs: FolderSpec[] = [
    { label: "Pasta de Marca", folderId: folders.brandFolderId, url: brandUrl, onUrl: onBrandUrl },
    { label: "Pasta de Arquivos", folderId: folders.productsFolderId, url: productsUrl, onUrl: onProductsUrl },
    { label: "Pasta de Edição", folderId: folders.uploadsFolderId, url: uploadsUrl, onUrl: onUploadsUrl },
  ];

  return (
    <fieldset className="admin-group">
      <legend>Materiais (Google Drive)</legend>
      {folders.syncedAt ? (
        <p className="admin-hint">
          Sincronizado pela automação em {new Date(folders.syncedAt).toLocaleString("pt-BR")}
        </p>
      ) : null}
      <div className="drive-folders">
        {specs.map((s) => (
          <div className="drive-folder" key={s.label}>
            <div className="drive-folder-head">
              <strong>{s.label}</strong>
              <span className={`admin-pill ${s.folderId ? "on" : "muted"}`}>
                {s.folderId ? "Sincronizado via automação" : "Vinculado manualmente"}
              </span>
              {s.url ? (
                <a className="admin-btn ghost" href={s.url} target="_blank" rel="noreferrer">
                  Abrir ↗
                </a>
              ) : null}
            </div>
            {s.folderId ? (
              <FolderPreview folderId={s.folderId} />
            ) : (
              <label className="admin-field">
                <span>Link da pasta</span>
                <input value={s.url} onChange={(e) => s.onUrl(e.target.value)} placeholder="https://drive.google.com/…" />
              </label>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
