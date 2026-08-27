"use client";

import type { DriveFolderIds } from "@/lib/supabase";
import { driveFolderIdFromUrl } from "@/lib/googleDrive";
import DriveBrowser from "../../DriveBrowser";

// As pastas do Drive na visão do cliente. Mesmo navegador do cadastro
// (app/admin/DriveBrowser.tsx) — a diferença aqui é que não há campo de link:
// esta tela é para olhar o material, não para editar o vínculo.
//
// Antes esta tela tinha a própria cópia da busca e dizia "preview indisponível"
// para pasta vinculada à mão. O id sempre esteve dentro da URL colada; agora é
// lido de lá e a pasta navega igual.

function Folder({ label, folderId, url }: { label: string; folderId: string | null; url: string | null }) {
  const browsableId = folderId ?? driveFolderIdFromUrl(url);

  return (
    <div className="drive-folder">
      <div className="drive-folder-head">
        <strong>{label}</strong>
        <span className={`admin-pill ${folderId ? "on" : "muted"}`}>{folderId ? "Sincronizado" : "Manual"}</span>
        {url ? (
          <a className="admin-btn ghost" href={url} target="_blank" rel="noreferrer">
            Abrir ↗
          </a>
        ) : null}
      </div>
      {browsableId ? (
        <DriveBrowser folderId={browsableId} label={label} limit={12} />
      ) : (
        <p className="admin-hint">Nenhuma pasta vinculada.</p>
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
