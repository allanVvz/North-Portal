"use client";

import Link from "next/link";
import type { DriveFolderIds } from "@/lib/supabase";
import { driveFolderIdFromUrl } from "@/lib/googleDrive";
import { GED_AREAS, gedClientFolderName } from "@/lib/ged/paths";
import DriveBrowser from "./DriveBrowser";

// Arquivos do cliente (tecnicamente o GED da plataforma — lib/ged).
//
// Todo cliente tem a sua estrutura, criada pela plataforma: Marca, Arquivos,
// Edição, Roteiros, Planilhas e Relatórios. No Google Drive da plataforma quando
// a conta de serviço está configurada; senão no armazenamento interno, e os
// arquivos aparecem em Informações. O cadastro não pede link colado.
//
// `client` é a identidade SALVA do cliente — nunca o nome em edição.
//
// Os links de pasta colados antes da estrutura automática continuam editáveis,
// recolhidos em "Links antigos do Drive", até a migração (roadmap R4.12).

type LegacyFolder = { label: string; url: string; onUrl: (value: string) => void };

export default function DriveFoldersSection({
  client,
  driveConfigured,
  folders,
  brandUrl,
  productsUrl,
  uploadsUrl,
  onBrandUrl,
  onProductsUrl,
  onUploadsUrl,
}: {
  client: { name: string; slug: string };
  driveConfigured: boolean;
  folders: DriveFolderIds;
  brandUrl: string;
  productsUrl: string;
  uploadsUrl: string;
  onBrandUrl: (value: string) => void;
  onProductsUrl: (value: string) => void;
  onUploadsUrl: (value: string) => void;
}) {
  // Pastas que a plataforma criou no Drive e dá para navegar aqui.
  const browsable = [
    { label: "Marca", folderId: folders.brandFolderId },
    { label: "Arquivos", folderId: folders.productsFolderId },
    { label: "Edição", folderId: folders.uploadsFolderId },
  ].filter((folder): folder is { label: string; folderId: string } => Boolean(folder.folderId));

  // Links colados à mão antes da estrutura automática (sem pasta da plataforma).
  const legacy: LegacyFolder[] = [
    { label: "Marca", url: brandUrl, onUrl: onBrandUrl, hasPlatformFolder: Boolean(folders.brandFolderId) },
    { label: "Arquivos", url: productsUrl, onUrl: onProductsUrl, hasPlatformFolder: Boolean(folders.productsFolderId) },
    { label: "Edição", url: uploadsUrl, onUrl: onUploadsUrl, hasPlatformFolder: Boolean(folders.uploadsFolderId) },
  ]
    .filter((folder) => !folder.hasPlatformFolder)
    .map(({ label, url, onUrl }) => ({ label, url, onUrl }));
  const legacyFilled = legacy.filter((folder) => folder.url.trim()).length;

  return (
    <fieldset className="admin-group">
      <legend>Arquivos do cliente</legend>
      <p className="admin-hint">
        ✓ Estrutura criada automaticamente em <b>Clientes/{gedClientFolderName(client)}</b> ·{" "}
        {driveConfigured ? (
          "Google Drive da plataforma"
        ) : (
          <>armazenamento interno — os arquivos aparecem em <Link href="/admin/documentos">Informações</Link></>
        )}
      </p>
      <ul className="ged-areas">
        {GED_AREAS.map((area) => <li key={area.key}>{area.label}</li>)}
      </ul>

      {browsable.length ? (
        <div className="drive-folders">
          {browsable.map((folder) => (
            <div className="drive-folder" key={folder.label}>
              <div className="drive-folder-head">
                <strong>{folder.label}</strong>
              </div>
              <DriveBrowser folderId={folder.folderId} label={folder.label} />
            </div>
          ))}
        </div>
      ) : null}

      {legacy.length ? (
        <details className="ged-legacy">
          <summary>Links antigos do Drive{legacyFilled ? ` (${legacyFilled})` : ""}</summary>
          <p className="admin-hint">Pastas coladas antes da estrutura automática. Continuam valendo até a migração.</p>
          <div className="drive-folders">
            {legacy.map((folder) => {
              const browsableId = driveFolderIdFromUrl(folder.url);
              return (
                <div className="drive-folder" key={folder.label}>
                  <div className="drive-folder-head">
                    <strong>{folder.label}</strong>
                    {folder.url ? <a className="admin-btn ghost" href={folder.url} target="_blank" rel="noreferrer">Abrir ↗</a> : null}
                  </div>
                  <label className="admin-field">
                    <span>Link da pasta</span>
                    <input value={folder.url} onChange={(event) => folder.onUrl(event.target.value)} placeholder="https://drive.google.com/…" />
                  </label>
                  {browsableId ? <DriveBrowser folderId={browsableId} label={folder.label} /> : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}
