"use client";

import Link from "next/link";
import type { DriveFolderIds } from "@/lib/supabase";
import { driveFolderIdFromUrl } from "@/lib/googleDrive";
import { GED_AREAS, gedClientFolderName } from "@/lib/ged/paths";
import DriveBrowser from "./DriveBrowser";

// Materiais do cliente = o GED da plataforma (15/09).
//
// Antes o cadastro pedia para colar o link de três pastas do Drive do cliente.
// Agora todo cliente tem a sua árvore no GED — Clientes/<nome> (<slug>)/Marca,
// Arquivos, Edição, Roteiros, Planilhas, Relatórios —, criada pela plataforma:
// no Drive da plataforma quando a conta de serviço está configurada, senão no
// armazenamento interno (os arquivos aparecem em Informações). Links do Google
// enviados ao NorthAi são copiados para dentro dele (lib/ged).
//
// Os links antigos colados à mão continuam editáveis, recolhidos, até a
// migração para o GED.

type FolderSpec = {
  label: string;
  folderId: string | null;
  url: string;
  onUrl: (v: string) => void;
};

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
  onBrandUrl: (v: string) => void;
  onProductsUrl: (v: string) => void;
  onUploadsUrl: (v: string) => void;
}) {
  const specs: FolderSpec[] = [
    { label: "Marca", folderId: folders.brandFolderId, url: brandUrl, onUrl: onBrandUrl },
    { label: "Arquivos", folderId: folders.productsFolderId, url: productsUrl, onUrl: onProductsUrl },
    { label: "Edição", folderId: folders.uploadsFolderId, url: uploadsUrl, onUrl: onUploadsUrl },
  ];
  const provisioned = specs.filter((spec) => spec.folderId);
  const legacy = specs.filter((spec) => !spec.folderId);
  const legacyFilled = legacy.filter((spec) => spec.url.trim()).length;

  return (
    <fieldset className="admin-group">
      <legend>GED — materiais do cliente</legend>
      <p className="admin-hint">
        <b>Clientes/{gedClientFolderName(client)}</b> ·{" "}
        {driveConfigured
          ? folders.rootFolderId ? "pastas no Drive da plataforma" : "as pastas no Drive da plataforma são criadas ao salvar um novo cliente"
          : <>armazenamento interno — os arquivos aparecem em <Link href="/admin/documentos">Informações</Link></>}
      </p>
      <ul className="ged-areas">
        {GED_AREAS.map((area) => <li key={area.key}>{area.label}</li>)}
      </ul>
      {folders.syncedAt ? (
        <p className="admin-hint">Pastas criadas pela plataforma em {new Date(folders.syncedAt).toLocaleString("pt-BR")}</p>
      ) : null}

      {provisioned.length ? (
        <div className="drive-folders">
          {provisioned.map((spec) => (
            <div className="drive-folder" key={spec.label}>
              <div className="drive-folder-head">
                <strong>{spec.label}</strong>
                <span className="admin-pill on">GED</span>
                {spec.url ? <a className="admin-btn ghost" href={spec.url} target="_blank" rel="noreferrer">Abrir ↗</a> : null}
              </div>
              <DriveBrowser folderId={spec.folderId!} label={spec.label} />
            </div>
          ))}
        </div>
      ) : null}

      {legacy.length ? (
        <details className="ged-legacy" open={legacyFilled > 0 && !provisioned.length}>
          <summary>Links antigos do Drive{legacyFilled ? ` (${legacyFilled})` : ""} — serão migrados para o GED</summary>
          <div className="drive-folders">
            {legacy.map((spec) => {
              const browsableId = driveFolderIdFromUrl(spec.url);
              return (
                <div className="drive-folder" key={spec.label}>
                  <div className="drive-folder-head">
                    <strong>{spec.label}</strong>
                    <span className="admin-pill muted">Link antigo</span>
                    {spec.url ? <a className="admin-btn ghost" href={spec.url} target="_blank" rel="noreferrer">Abrir ↗</a> : null}
                  </div>
                  <label className="admin-field">
                    <span>Link da pasta</span>
                    <input value={spec.url} onChange={(e) => spec.onUrl(e.target.value)} placeholder="https://drive.google.com/…" />
                  </label>
                  {browsableId ? <DriveBrowser folderId={browsableId} label={spec.label} /> : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}
