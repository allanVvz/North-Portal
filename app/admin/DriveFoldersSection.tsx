"use client";

import type { DriveFolderIds } from "@/lib/supabase";
import { driveFolderIdFromUrl } from "@/lib/googleDrive";
import DriveBrowser from "./DriveBrowser";

// Materiais do cliente: as três pastas do Drive, cada uma navegável ali mesmo,
// para o admin não precisar abrir o Drive só para ver se o cliente subiu
// alguma coisa.
//
// A pasta é identificada por id, e o id vem de duas origens que valem o mesmo:
// a automação de provisionamento (que guarda o id ao criar a pasta) ou o link
// colado à mão. Antes só a primeira rendia preview — quem vinculava uma pasta
// existente ficava com um campo de texto e nada mais, mesmo com o id ali,
// legível dentro da própria URL.

type FolderSpec = {
  label: string;
  folderId: string | null;
  url: string;
  onUrl: (v: string) => void;
};

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
        {specs.map((s) => {
          // O id da automação manda; na falta dele, o id que está dentro da URL
          // colada serve igual — é o mesmo identificador.
          const browsableId = s.folderId ?? driveFolderIdFromUrl(s.url);
          return (
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
              {/* O campo continua visível para a pasta vinculada à mão: é por
                  ele que se troca o link, e some só quando a automação é a dona
                  do id. */}
              {!s.folderId ? (
                <label className="admin-field">
                  <span>Link da pasta</span>
                  <input value={s.url} onChange={(e) => s.onUrl(e.target.value)} placeholder="https://drive.google.com/…" />
                </label>
              ) : null}
              {browsableId ? <DriveBrowser folderId={browsableId} label={s.label} /> : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
