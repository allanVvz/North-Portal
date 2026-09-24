"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreativeDriveContext, CreativeDriveWorkspace as Workspace } from "@/lib/creativeDrive";
import type { DriveFile } from "@/lib/googleDrive";

type Payload = { context: CreativeDriveContext; workspace: Workspace | null };

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Nao foi possivel concluir a operacao.");
  return body;
}

export default function CreativeDriveWorkspace({
  taskId,
  selectedAssetIds,
  onSelectedAssetIdsChange,
}: {
  taskId: string;
  selectedAssetIds: string[];
  onSelectedAssetIdsChange: (ids: string[]) => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [eligible, setEligible] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/tasks/${taskId}/drive-workspace`, { cache: "no-store" });
    if (response.status === 403 || response.status === 400) {
      setEligible(false);
      return;
    }
    setPayload(await responseJson<Payload>(response));
  }, [taskId]);

  useEffect(() => {
    setEligible(true);
    setPayload(null);
    setError("");
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar o Drive."));
  }, [load]);

  async function provision() {
    setBusy("provision"); setError("");
    try {
      const response = await fetch(`/api/admin/tasks/${taskId}/drive-workspace`, { method: "POST" });
      await responseJson<Workspace>(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao provisionar.");
    } finally { setBusy(""); }
  }

  async function assetAction(body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/tasks/${taskId}/drive-assets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return responseJson<Record<string, unknown>>(response);
  }

  async function link(file: DriveFile, linkedAssetId?: string) {
    setBusy(file.id); setError("");
    try {
      if (linkedAssetId) {
        await assetAction({ action: "unlink_raw", assetId: linkedAssetId });
        onSelectedAssetIdsChange(selectedAssetIds.filter((id) => id !== linkedAssetId));
      } else {
        await assetAction({ action: "link_raw", driveFileId: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink });
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar o atalho."); }
    finally { setBusy(""); }
  }

  async function upload(file: File) {
    setBusy("upload"); setError("");
    try {
      const started = await assetAction({ action: "start_upload", name: file.name, mimeType: file.type || "application/octet-stream", size: file.size }) as { sessionUrl?: string };
      if (!started.sessionUrl) throw new Error("O Drive nao retornou a sessao de upload.");
      const uploaded = await fetch(started.sessionUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const metadata = await responseJson<{ id?: string }>(uploaded);
      if (!metadata.id) throw new Error("O Drive nao retornou o arquivo enviado.");
      await assetAction({ action: "complete_upload", driveFileId: metadata.id });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no upload."); }
    finally { setBusy(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function mutate(action: "promote" | "trash_final" | "restore_final", id: string) {
    setBusy(id); setError("");
    try {
      await assetAction(action === "promote" ? { action, assetId: id } : { action, versionId: id });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar a versao."); }
    finally { setBusy(""); }
  }

  const workspace = payload?.workspace;
  const linkedByDriveId = useMemo(() => new Map(
    (workspace?.assets ?? []).filter((asset) => asset.role === "raw")
      .map((asset) => [asset.drive_file_id, workspace?.raw_links.find((linkRow) => linkRow.asset_id === asset.id) ? asset.id : undefined]),
  ), [workspace]);
  const assetsById = useMemo(() => new Map((workspace?.assets ?? []).map((asset) => [asset.id, asset])), [workspace]);
  const sourceItems = useMemo(() => [
    ...(workspace?.source_files.script ?? []).map((file) => ({ file, source: "Roteiro" })),
    ...(workspace?.source_files.capture ?? []).map((file) => ({ file, source: "Captacao" })),
  ], [workspace]);

  if (!eligible) return null;
  if (!payload && !error) return <div className="tm-box creative-drive"><p className="admin-sub">Carregando workspace do Drive...</p></div>;

  return (
    <div className="tm-box creative-drive">
      <div className="tm-box-head creative-drive-head">
        <div>
          <p className="tm-box-label">Workspace do Criativo</p>
          {payload?.context.captureDate ? <small>Diaria {payload.context.captureDate.split("-").reverse().join("/")}</small> : null}
        </div>
        {!workspace || workspace.status !== "ready" ? (
          <button type="button" className="admin-btn primary" disabled={Boolean(busy)} onClick={() => void provision()}>
            {busy === "provision" ? "Preparando..." : workspace?.status === "error" ? "Tentar novamente" : "Preparar pastas"}
          </button>
        ) : <span className="np-pill green">Drive pronto</span>}
      </div>
      {error || workspace?.last_error ? <p className="creative-drive-error">{error || workspace?.last_error}</p> : null}

      {workspace?.status === "ready" ? <>
        <div className="creative-drive-section">
          <strong>Brutos da diaria</strong>
          <p className="admin-sub">Marque arquivos de Roteiro ou Captacao para criar atalhos neste Criativo. O original nunca e apagado.</p>
          {sourceItems.map(({ file, source }) => {
            const linkedAssetId = linkedByDriveId.get(file.id);
            return <label className="creative-drive-file" key={`${source}-${file.id}`}>
              <input type="checkbox" checked={Boolean(linkedAssetId)} disabled={busy === file.id} onChange={() => void link(file, linkedAssetId)} />
              <span><b>{file.name}</b><small>{source}</small></span>
              {file.webViewLink ? <a href={file.webViewLink} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Abrir</a> : null}
            </label>;
          })}
          {workspace.source_files.script.length + workspace.source_files.capture.length === 0 ? <p className="admin-sub">Nenhum bruto encontrado nesta diaria.</p> : null}
        </div>

        <div className="creative-drive-section">
          <div className="creative-drive-row">
            <strong>Preview e versoes</strong>
            <button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>{busy === "upload" ? "Enviando..." : "Enviar arquivo"}</button>
            <input ref={fileRef} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          </div>
          {workspace.assets.filter((asset) => asset.role !== "raw" && asset.state !== "trashed").map((asset) => (
            <div className="creative-drive-file" key={asset.id}>
              <input
                type="checkbox"
                checked={selectedAssetIds.includes(asset.id)}
                aria-label={`Anexar ${asset.name} ao comentario`}
                onChange={() => onSelectedAssetIdsChange(selectedAssetIds.includes(asset.id) ? selectedAssetIds.filter((id) => id !== asset.id) : [...selectedAssetIds, asset.id])}
              />
              <span><b>{asset.name}</b><small>{asset.role === "final" ? "Final" : "Preview"}</small></span>
              {asset.web_view_link ? <a href={asset.web_view_link} target="_blank" rel="noreferrer">Abrir</a> : null}
              {asset.role === "preview" ? <button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void mutate("promote", asset.id)}>Promover</button> : null}
            </div>
          ))}
          {workspace.assets.filter((asset) => asset.role !== "raw" && asset.state !== "trashed").length === 0 ? <p className="admin-sub">Envie o primeiro Preview.</p> : null}
        </div>

        {workspace.final_versions.length ? <div className="creative-drive-section">
          <strong>Historico de finais</strong>
          {workspace.final_versions.map((version) => {
            const asset = assetsById.get(version.asset_id);
            return <div className="creative-drive-file" key={version.id}>
              <span><b>v{version.version_number} · {asset?.name ?? "Arquivo"}</b><small>{version.state === "current" ? "Atual" : version.state === "trashed" ? "Excluida" : "Anterior"}</small></span>
              {version.state === "trashed"
                ? <button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void mutate("restore_final", version.id)}>Restaurar</button>
                : <button type="button" className="admin-btn ghost danger" disabled={Boolean(busy)} onClick={() => void mutate("trash_final", version.id)}>Remover</button>}
            </div>;
          })}
        </div> : null}
        {selectedAssetIds.length ? <p className="creative-drive-selected">{selectedAssetIds.length} arquivo(s) serao associados ao proximo comentario.</p> : null}
      </> : null}
    </div>
  );
}
