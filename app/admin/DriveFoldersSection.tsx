"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [root, setRoot] = useState(folders.rootFolderId ?? "");
  const [raw, setRaw] = useState(folders.rawFolderId ?? "");
  const [editing, setEditing] = useState(folders.uploadsFolderId ?? "");
  const [available, setAvailable] = useState<{ roots: Array<{ id: string; name: string }>; children: Array<{ id: string; name: string }> }>({ roots: [], children: [] });
  const [folderMessage, setFolderMessage] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const rootId = driveFolderIdFromUrl(root) ?? root.trim();

  useEffect(() => {
    if (!driveConfigured) return;
    let cancelled = false;
    fetch(`/api/admin/client/${encodeURIComponent(client.slug)}/drive-folders?root=${encodeURIComponent(rootId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (!cancelled && result) setAvailable(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client.slug, driveConfigured, rootId]);

  async function saveFolders() {
    setFolderBusy(true); setFolderMessage("");
    try {
      const response = await fetch(`/api/admin/client/${encodeURIComponent(client.slug)}/drive-folders`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: root || null, raw: raw || null, editing: editing || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Não foi possível vincular as pastas.");
      setRoot(result.rootFolderId ?? ""); setRaw(result.rawFolderId ?? ""); setEditing(result.uploadsFolderId ?? "");
      setFolderMessage("Pastas validadas e vinculadas.");
    } catch (error) { setFolderMessage(error instanceof Error ? error.message : "Falha ao vincular pastas."); }
    finally { setFolderBusy(false); }
  }
  // Pastas que a plataforma criou no Drive e dá para navegar aqui.
  const browsable = [
    { label: "Marca", folderId: folders.brandFolderId },
    { label: "Arquivos", folderId: folders.productsFolderId },
    { label: "Edição", folderId: driveFolderIdFromUrl(editing) ?? editing.trim() },
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
        Arquivos de <b>Clientes/{gedClientFolderName(client)}</b> ·{" "}
        {driveConfigured ? (
          "Google Drive da plataforma"
        ) : (
          <>armazenamento interno — os arquivos aparecem em <Link href="/admin/documentos">Informações</Link></>
        )}
      </p>
      <ul className="ged-areas">
        {GED_AREAS.map((area) => <li key={area.key}>{area.label}</li>)}
      </ul>

      {driveConfigured ? <div className="drive-folder-links-editor">
        <p className="admin-hint">Vincule pastas que já existem em CLIENTES. Acesso e posição são verificados ao salvar.</p>
        <label className="admin-field">Raiz
          <input list={`drive-roots-${client.slug}`} value={root} onChange={(event) => { setRoot(event.target.value); setRaw(""); setEditing(""); }} placeholder="ID ou link da pasta do cliente" />
          <datalist id={`drive-roots-${client.slug}`}>{available.roots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
        </label>
        <label className="admin-field">Brutos
          <input list={`drive-children-${client.slug}`} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="ID ou link da pasta Brutos" />
        </label>
        <label className="admin-field">Edição
          <input list={`drive-children-${client.slug}`} value={editing} onChange={(event) => setEditing(event.target.value)} placeholder="ID ou link da pasta Edição" />
        </label>
        <datalist id={`drive-children-${client.slug}`}>{available.children.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
        <div className="set-actions"><button type="button" className="admin-btn ghost" disabled={folderBusy} onClick={() => void saveFolders()}>
          {folderBusy ? "Validando…" : "Salvar pastas"}
        </button>{folderMessage ? <span role="status" className="admin-sub">{folderMessage}</span> : null}</div>
      </div> : null}

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
