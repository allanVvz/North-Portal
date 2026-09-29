"use client";

import { useEffect, useState } from "react";
import type { DeliveryLink } from "@/lib/deliveryLinks";
import type { DriveFile } from "@/lib/googleDrive";

// Arquivos de uma Entrega SEM a automação de pastas (30/09/2026): o que foi
// colado como link — no card ou nas etapas — vira vitrine, igual à caixa de
// Finais das Entregas com pasta automática. Pasta colada é aberta pela conta
// do app e os arquivos dela entram na grade; se a conta não enxerga a pasta,
// fica o atalho para abrir no Drive. O primeiro arquivo é a capa do card e do
// Feed (mesma ordem de lib/deliveryLinks.ts).

const SOURCE_LABEL: Record<string, string> = { edicao: "Edição", entrega: "Neste card", roteiro: "Roteiro", captacao: "Captação", publicacao: "Publicação" };
const shortDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

type Item = { id: string; name: string | null; mimeType: string | null; source: string; at: string | null; folder?: string };
type FolderState = { id: string; source: string; files: DriveFile[] | null; name?: string };

export default function LegacyDriveFiles({ links }: { links: DeliveryLink[] }) {
  // `/open?id=` pode ser pasta: pergunta ao servidor (resposta guardada 1 dia no navegador).
  const [kinds, setKinds] = useState<Record<string, "file" | "folder" | "unknown">>({});
  const [folders, setFolders] = useState<Record<string, FolderState>>({});
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const key = links.map((link) => link.id).join(",");

  useEffect(() => {
    let active = true;
    for (const link of links) {
      const resolve = link.kind === "folder" ? Promise.resolve("folder" as const)
        : fetch(`/api/admin/drive/kind?id=${encodeURIComponent(link.id)}`).then((response) => (response.ok ? response.json() : { kind: "unknown" })).then((data: { kind: "file" | "folder" | "unknown" }) => data.kind).catch(() => "unknown" as const);
      void resolve.then((kind) => {
        if (!active) return;
        setKinds((current) => ({ ...current, [link.id]: kind }));
        if (kind !== "folder") return;
        fetch(`/api/admin/drive/files?folderId=${encodeURIComponent(link.id)}&limit=24`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data: { files?: DriveFile[] } | null) => { if (active) setFolders((current) => ({ ...current, [link.id]: { id: link.id, source: link.source, files: (data?.files ?? []).filter((file) => file.mimeType !== "application/vnd.google-apps.folder").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pt-BR", { numeric: true })) } })); })
          .catch(() => { if (active) setFolders((current) => ({ ...current, [link.id]: { id: link.id, source: link.source, files: [] } })); });
      });
    }
    return () => { active = false; };
    // `links` entra pela chave: a mesma lista de ids não refaz as consultas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const items: Item[] = [];
  for (const link of links) {
    const kind = kinds[link.id] ?? link.kind;
    if (kind === "folder") {
      for (const file of folders[link.id]?.files ?? []) items.push({ id: file.id, name: file.name ?? null, mimeType: file.mimeType ?? null, source: link.source, at: link.at, folder: link.id });
    } else items.push({ id: link.id, name: null, mimeType: null, source: link.source, at: link.at });
  }
  const seen = new Set<string>();
  const visible = items.filter((item) => !broken.has(item.id) && !seen.has(item.id) && (seen.add(item.id), true));
  const unreadable = links.filter((link) => (kinds[link.id] ?? link.kind) === "folder" && folders[link.id] && !folders[link.id].files?.length);
  const hidden = items.filter((item) => broken.has(item.id)).length;

  return (
    <div className="legacy-drive">
      {visible.length ? (
        <div className="tm-material-media-grid">
          {visible.slice(0, 9).map((item, index) => (
            <a key={item.id} className="tm-material-media" href={`https://drive.google.com/file/d/${item.id}/view`} target="_blank" rel="noreferrer" title={item.name ?? "Abrir no Drive"}>
              <span className="tm-material-media-image">
                {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive */}
                <img src={`/api/admin/drive/thumbnail/${encodeURIComponent(item.id)}`} alt="" loading="lazy" onError={() => setBroken((current) => new Set(current).add(item.id))} />
                <span>{item.mimeType?.startsWith("video/") ? "▶" : "▧"}</span>
              </span>
              <span className="tm-material-media-caption">
                <b>{index === 0 ? "Capa · " : ""}{item.name ?? `Arquivo ${index + 1}`}</b>
                <small>{SOURCE_LABEL[item.source] ?? item.source}{item.folder ? " · pasta colada" : ""}{item.at ? ` · ${shortDate(item.at)}` : ""}</small>
              </span>
            </a>
          ))}
        </div>
      ) : <p className="tm-materials-empty">Nenhum arquivo com prévia nos links colados.</p>}
      {visible.length > 9 || unreadable.length || hidden ? (
        <p className="legacy-drive-foot">
          {visible.length > 9 ? <span>+{visible.length - 9} arquivos</span> : null}
          {unreadable.map((folder) => <a key={folder.id} href={`https://drive.google.com/drive/folders/${folder.id}`} target="_blank" rel="noreferrer">Pasta de {SOURCE_LABEL[folder.source] ?? folder.source} ↗</a>)}
          {hidden ? <span>{hidden} sem prévia (pasta, documento ou sem acesso)</span> : null}
        </p>
      ) : null}
    </div>
  );
}
