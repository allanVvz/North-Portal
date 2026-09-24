"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreativeDriveContext, CreativeDriveWorkspace as Workspace } from "@/lib/creativeDrive";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import type { DriveFile } from "@/lib/googleDrive";
import { formatFileSize } from "@/lib/documentFiles";
import BackArrowIcon from "./BackArrowIcon";

type Payload = { context: CreativeDriveContext; workspace: Workspace | null };
type Target = { id: string; title: string };
type FileItem = { id: string; name: string; mimeType: string; size: number | null; url: string | null; source: string; assetId?: string };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body;
}

export default function CreativeDriveWorkspace({ taskId, targets, summaries, initialAssetId, selectedAssetIds, onSelectedAssetIdsChange, onChanged, onBack, onClose }: {
  taskId: string;
  targets: Target[];
  summaries: CreativeMaterialWorkspace[];
  initialAssetId?: string | null;
  selectedAssetIds: string[];
  onSelectedAssetIdsChange: (ids: string[]) => void;
  onChanged: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [activeTaskId, setActiveTaskId] = useState(taskId);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FileItem | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => setPayload(await json<Payload>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-workspace`, { cache: "no-store" }))), [activeTaskId]);
  useEffect(() => {
    setPayload(null); setSelected(null); setError("");
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar o Drive."));
  }, [load]);

  async function action(body: Record<string, unknown>) {
    return json<Record<string, unknown>>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-assets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  }
  async function changed(run: () => Promise<unknown>, key: string) {
    setBusy(key); setError("");
    try { await run(); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar o Drive."); }
    finally { setBusy(""); }
  }
  async function link(file: DriveFile, linkedId?: string) {
    await changed(async () => {
      if (linkedId) {
        await action({ action: "unlink_raw", assetId: linkedId });
        onSelectedAssetIdsChange(selectedAssetIds.filter((id) => id !== linkedId));
      } else await action({ action: "link_raw", driveFileId: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink });
    }, file.id);
  }
  async function upload(file: File) {
    await changed(async () => {
      const started = await action({ action: "start_upload", name: file.name, mimeType: file.type || "application/octet-stream", size: file.size }) as { sessionUrl?: string };
      if (!started.sessionUrl) throw new Error("O Drive não retornou a sessão de upload.");
      const metadata = await json<{ id?: string }>(await fetch(started.sessionUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }));
      if (!metadata.id) throw new Error("O Drive não retornou o arquivo enviado.");
      await action({ action: "complete_upload", driveFileId: metadata.id });
    }, "upload");
    if (input.current) input.current.value = "";
  }
  async function version(actionName: "promote" | "trash_final" | "restore_final", id: string) {
    await changed(() => action(actionName === "promote" ? { action: actionName, assetId: id } : { action: actionName, versionId: id }), id);
  }
  async function provision() {
    await changed(async () => json(await fetch(`/api/admin/tasks/${activeTaskId}/drive-workspace`, { method: "POST" })), "provision");
  }

  const workspace = payload?.workspace;
  const assetsById = useMemo(() => new Map((workspace?.assets ?? []).map((asset) => [asset.id, asset])), [workspace]);
  const linked = useMemo(() => new Map((workspace?.assets ?? []).filter((asset) => asset.role === "raw" && workspace?.raw_links.some((row) => row.asset_id === asset.id)).map((asset) => [asset.drive_file_id, asset.id])), [workspace]);
  const sources = useMemo(() => [
    ...(workspace?.source_files.script ?? []).map((file) => ({ file, source: "Roteiro" })),
    ...(workspace?.source_files.capture ?? []).map((file) => ({ file, source: "Captação" })),
  ], [workspace]);
  const files: FileItem[] = (workspace?.assets ?? []).filter((asset) => asset.role !== "raw" && asset.state === "active").map((asset) => ({
    id: asset.drive_file_id, assetId: asset.id, name: asset.name, mimeType: asset.mime_type, size: asset.size_bytes,
    url: asset.web_view_link, source: asset.role === "final" ? "Final" : "Preview",
  }));
  const current = workspace?.final_versions.find((item) => item.state === "current");
  const firstSource = sources[0];
  const preview = selected ?? files.find((file) => file.assetId === initialAssetId) ?? files.find((file) => file.assetId === current?.asset_id) ?? files[0] ?? (firstSource ? { id: firstSource.file.id, name: firstSource.file.name, mimeType: firstSource.file.mimeType, size: null, url: firstSource.file.webViewLink, source: firstSource.source } : null);
  const currentTarget = targets.find((target) => target.id === activeTaskId);
  const targetSummaries = summaries.filter((summary) => summary.capture_task_id === payload?.context.captureTaskId);

  return <div className="kb-modal-backdrop" onClick={onClose}><div className="tm tm-lg docprev-tm creative-drive-modal" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="tm-back tm-back-floating" onClick={onBack} aria-label="Voltar para o card"><BackArrowIcon /></button>
    <div className="tm-head tm-head-tone-purple"><span className="tm-head-ico" aria-hidden>▣</span><div className="tm-head-text"><strong className="docprev-title">Materiais · {currentTarget?.title ?? "Criativo"}</strong><span className="admin-sub">Drive · Preview e histórico de finais</span></div><button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button></div>
    <div className="tm-layout"><div className="tm-main creative-drive-main">
      {preview ? <div className="creative-drive-preview"><iframe key={preview.id} src={`https://drive.google.com/file/d/${encodeURIComponent(preview.id)}/preview`} title={`Preview de ${preview.name}`} loading="lazy" /><div className="creative-drive-preview-caption"><b>{preview.name}</b><span>{preview.source}</span>{preview.url ? <a href={preview.url} target="_blank" rel="noreferrer">Abrir no Drive ↗</a> : null}</div></div> : <div className="creative-drive-empty">Selecione um arquivo para visualizar.</div>}
      {error || workspace?.last_error || workspace?.source_error ? <p className="creative-drive-error" role="alert">{error || workspace?.last_error || workspace?.source_error}</p> : null}
      {!payload && !error ? <p className="admin-sub">Carregando materiais…</p> : null}
      {payload && (!workspace || workspace.status !== "ready") ? <button type="button" className="admin-btn primary" disabled={Boolean(busy)} onClick={() => void provision()}>{busy === "provision" ? "Preparando…" : "Preparar pastas do Criativo"}</button> : null}
      {workspace?.status === "ready" ? <>
        <section className="creative-drive-section"><div className="creative-drive-row"><strong>Brutos da captação</strong><small>{sources.length} arquivo(s)</small></div><p className="admin-sub">Classifique para criar um atalho neste Criativo. O original permanece na Captação. Selecione outro Criativo para vincular o mesmo bruto a ele.</p>
          {sources.map(({ file, source }) => <div className="creative-drive-file" key={`${source}-${file.id}`}><input type="checkbox" aria-label={`Classificar ${file.name} em ${currentTarget?.title ?? "Criativo"}`} checked={Boolean(linked.get(file.id))} disabled={Boolean(busy)} onChange={() => void link(file, linked.get(file.id))} /><button type="button" className="creative-drive-file-name" onClick={() => setSelected({ id: file.id, name: file.name, mimeType: file.mimeType, size: null, url: file.webViewLink, source })}><b>{file.name}</b><small>{source}</small></button></div>)}
          {!sources.length && !workspace.source_error ? <p className="admin-sub">Nenhum bruto encontrado nesta diária.</p> : null}
        </section>
        <section className="creative-drive-section"><div className="creative-drive-row"><strong>Preview</strong><button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => input.current?.click()}>{busy === "upload" ? "Enviando…" : "Enviar arquivo"}</button><input ref={input} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
          {files.map((file) => <div className="creative-drive-file" key={file.assetId}><input type="checkbox" checked={selectedAssetIds.includes(file.assetId!)} aria-label={`Anexar ${file.name} ao comentário`} onChange={() => onSelectedAssetIdsChange(selectedAssetIds.includes(file.assetId!) ? selectedAssetIds.filter((id) => id !== file.assetId) : [...selectedAssetIds, file.assetId!])} /><button type="button" className="creative-drive-file-name" onClick={() => setSelected(file)}><b>{file.name}</b><small>{file.source}</small></button>{file.source === "Preview" ? <button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void version("promote", file.assetId!)}>Promover</button> : null}</div>)}
          {!files.length ? <p className="admin-sub">Envie o primeiro Preview.</p> : null}
        </section>
      </> : null}
    </div><aside className="tm-side creative-drive-side">
      {targets.length > 1 ? <section className="tm-box docprev-cellbox"><p className="tm-box-label">Classificar em Criativo</p><div className="creative-drive-targets">{targets.map((target) => <button type="button" key={target.id} className={`creative-drive-target${target.id === activeTaskId ? " on" : ""}`} onClick={() => setActiveTaskId(target.id)}>{target.title}<small>{targetSummaries.find((summary) => summary.creative_task_id === target.id)?.raw_links.length ?? 0} bruto(s)</small></button>)}</div></section> : null}
      <section className="tm-box docprev-cellbox"><p className="tm-box-label">Detalhes</p><div className="docprev-cells"><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Arquivo</span><span className="tm-cell-static docprev-cell-wrap">{preview?.name ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Origem</span><span className="tm-cell-static">{preview?.source ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Formato</span><span className="tm-cell-static docprev-cell-wrap">{preview?.mimeType ?? "—"}</span></div></div>{preview?.size != null ? <div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Tamanho</span><span className="tm-cell-static">{formatFileSize(preview.size)}</span></div></div> : null}</div></section>
      {workspace?.final_versions.length ? <section className="tm-box docprev-cellbox"><p className="tm-box-label">Histórico de finais</p><div className="creative-drive-history">{workspace.final_versions.map((item) => { const asset = assetsById.get(item.asset_id); return <div className="creative-drive-history-row" key={item.id}><button type="button" onClick={() => asset && setSelected({ id: asset.drive_file_id, assetId: asset.id, name: asset.name, mimeType: asset.mime_type, size: asset.size_bytes, url: asset.web_view_link, source: `Final v${item.version_number}` })}><b>v{item.version_number} · {asset?.name ?? "Arquivo"}</b><small>{item.state === "current" ? "Atual" : item.state === "trashed" ? "Removida" : "Anterior"}</small></button><button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void version(item.state === "trashed" ? "restore_final" : "trash_final", item.id)}>{item.state === "trashed" ? "Restaurar" : "Remover"}</button></div>; })}</div></section> : null}
    </aside></div>
    <footer className="kb-modal-actions"><span>{selectedAssetIds.length ? `${selectedAssetIds.length} arquivo(s) para o próximo comentário` : ""}</span><span /><button type="button" className="admin-btn ghost" onClick={onBack}>Voltar ao card</button></footer>
  </div></div>;
}
