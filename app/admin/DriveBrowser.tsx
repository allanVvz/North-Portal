"use client";

import { useEffect, useState } from "react";
import { driveFileKind, isDriveFolder, type DriveFile } from "@/lib/googleDrive";

// Navegador de pastas do Drive — um só, usado no cadastro do cliente, na visão
// do cliente e no card. Antes cada uma dessas telas tinha a sua cópia de
// "busca a pasta e mostra miniaturas", nenhuma delas entrava em subpasta.
//
// Duas formas de listar, e a escolha não é nossa:
//
//   * conta de serviço configurada -> lista pela API, na nossa interface, com
//     trilha de navegação. Enxerga pasta privada compartilhada com ela.
//   * não configurada -> cai para o `embeddedfolderview` do próprio Google,
//     que navega sozinho, mas só funciona em pasta compartilhada como
//     "qualquer pessoa com o link".
//
// A segunda é o que existe hoje em produção (ver plan/CARD-COVER-PREVIEW.md,
// mesma pendência de credencial da capa). Sem as duas, some — nunca quebra a
// tela em volta.

const KIND_ICON: Record<ReturnType<typeof driveFileKind>, string> = {
  folder: "▸",
  image: "▣",
  video: "▶",
  doc: "▤",
  sheet: "▦",
  slide: "▧",
  pdf: "▤",
  other: "▨",
};

/** Um nível da trilha. O primeiro é sempre a pasta de origem. */
type Crumb = { id: string; name: string };

export default function DriveBrowser({
  folderId,
  label,
  /** Quantos itens buscar por nível. */
  limit = 24,
}: {
  folderId: string;
  label: string;
  limit?: number;
}) {
  const [path, setPath] = useState<Crumb[]>([{ id: folderId, name: label }]);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  // A pasta de origem pode mudar sem o componente desmontar (o admin cola outro
  // link no cadastro) — sem isto a trilha continuaria apontando para a antiga.
  useEffect(() => setPath([{ id: folderId, name: label }]), [folderId, label]);

  const current = path[path.length - 1];

  useEffect(() => {
    if (!current) return;
    let alive = true;
    setFiles(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/drive/files?folderId=${encodeURIComponent(current.id)}&limit=${limit}`,
        );
        if (!alive) return;
        if (!res.ok) {
          setFiles([]);
          return;
        }
        const data = (await res.json()) as { configured?: boolean; files?: DriveFile[] };
        setConfigured(data.configured ?? false);
        setFiles(data.files ?? []);
      } catch {
        if (alive) setFiles([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [current, limit]);

  if (!current) return null;

  // Sem conta de serviço não há o que listar: entrega a pasta ao embed do
  // Google, que resolve a navegação por conta própria quando ela é pública.
  if (configured === false) {
    return (
      <div className="drive-browser">
        <iframe
          className="drive-browser-embed"
          src={`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`}
          title={`Pasta ${label}`}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="drive-browser">
      {path.length > 1 ? (
        <nav className="drive-crumbs" aria-label="Caminho da pasta">
          {path.map((crumb, i) => (
            <span key={crumb.id}>
              {i > 0 ? <span className="drive-crumb-sep" aria-hidden>/</span> : null}
              {i === path.length - 1 ? (
                <span className="drive-crumb on">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  className="drive-crumb"
                  onClick={() => setPath((p) => p.slice(0, i + 1))}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {files === null ? (
        <p className="admin-hint">Carregando…</p>
      ) : files.length === 0 ? (
        <p className="admin-hint">{path.length > 1 ? "Subpasta vazia." : "Nenhum arquivo nesta pasta ainda."}</p>
      ) : (
        <div className="drive-thumbs">
          {files.map((file) =>
            isDriveFolder(file) ? (
              // Pasta desce um nível na nossa interface, em vez de jogar o
              // admin para fora, no Drive.
              <button
                type="button"
                key={file.id}
                className="drive-thumb is-folder"
                onClick={() => setPath((p) => [...p, { id: file.id, name: file.name }])}
                title={`Abrir ${file.name}`}
              >
                <span className="drive-thumb-box" aria-hidden="true">
                  {KIND_ICON.folder}
                </span>
                <span className="drive-thumb-name">{file.name}</span>
              </button>
            ) : (
              <a
                key={file.id}
                className="drive-thumb"
                href={file.webViewLink ?? undefined}
                target="_blank"
                rel="noreferrer"
                title={file.name}
              >
                <span className="drive-thumb-box" aria-hidden="true">
                  {file.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura
                    // já dimensionada pelo Drive; sem loader remoto configurado.
                    <img src={file.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    KIND_ICON[driveFileKind(file.mimeType)]
                  )}
                </span>
                <span className="drive-thumb-name">{file.name}</span>
              </a>
            ),
          )}
        </div>
      )}
    </div>
  );
}
