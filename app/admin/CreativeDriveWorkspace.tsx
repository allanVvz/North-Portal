"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { CreativeDriveContext, CreativeDriveWorkspace as Workspace } from "@/lib/creativeDrive";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import type { DriveFile } from "@/lib/googleDrive";
import { formatFileSize } from "@/lib/documentFiles";
import BackArrowIcon from "./BackArrowIcon";

type Payload = { context: CreativeDriveContext; workspace: Workspace | null };
type Target = { id: string; title: string };
type FileItem = { id: string; name: string; mimeType: string; size: number | null; url: string | null; source: string; assetId?: string };
type SourceKind = "script" | "capture";
type SourcePages = Record<SourceKind, string | null>;
const emptySources = (): Record<SourceKind, DriveFile[]> => ({ script: [], capture: [] });
const emptyPages = (): SourcePages => ({ script: null, capture: null });

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
  const [selectedRawIds, setSelectedRawIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [extraSources, setExtraSources] = useState(emptySources);
  const [nextPages, setNextPages] = useState<SourcePages>(emptyPages);
  const [loadingMore, setLoadingMore] = useState<SourceKind | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const targetRail = useRef<HTMLElement>(null);
  const draggedRawIds = useRef<string[]>([]);

  const load = useCallback(async (preserveSources = false) => {
    const next = await json<Payload>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-workspace`, { cache: "no-store" }));
    setPayload(next);
    if (!preserveSources) {
      setExtraSources(emptySources());
      setNextPages(next.workspace?.source_next_page_token ?? emptyPages());
    }
  }, [activeTaskId]);
  useEffect(() => {
    setPayload(null); setSelected(null); setError(""); setExtraSources(emptySources()); setNextPages(emptyPages());
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar o Drive."));
  }, [load]);

  async function action(body: Record<string, unknown>, targetId = activeTaskId) {
    return json<Record<string, unknown>>(await fetch(`/api/admin/tasks/${targetId}/drive-assets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  }
  async function changed(run: () => Promise<unknown>, key: string) {
    setBusy(key); setError("");
    try { await run(); await load(true); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar o Drive."); }
    finally { setBusy(""); }
  }
  function toggleRaw(id: string) {
    setNotice("");
    setSelectedRawIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }
  async function assignRaw(targetId: string, rawIds = selectedRawIds) {
    const uniqueIds = new Set(rawIds);
    const filesToAssign = sources.filter(({ file }) => uniqueIds.has(file.id));
    if (!filesToAssign.length || busy) return;
    setBusy("assign"); setError(""); setNotice("");
    let created = 0;
    try {
      for (const { file } of filesToAssign) {
        if (linkedToTarget(targetId, file.id)) continue;
        await action({ action: "link_raw", driveFileId: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink }, targetId);
        created += 1;
      }
      await load(true);
      onChanged();
      const targetName = targets.find((target) => target.id === targetId)?.title ?? "Criativo";
      setNotice(created ? `${created} arquivo(s) classificado(s) em ${targetName}. Os originais continuam na Captação.` : `Os arquivos já estão vinculados a ${targetName}.`);
    } catch (cause) {
      if (created) { await load(true).catch(() => undefined); onChanged(); }
      setError(`${created} vínculo(s) criado(s). ${cause instanceof Error ? cause.message : "Falha ao classificar os brutos."}`);
    } finally { setBusy(""); }
  }
  function dropRaw(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    let ids = draggedRawIds.current;
    try {
      const value = JSON.parse(event.dataTransfer.getData("application/x-north-raw-ids")) as unknown;
      if (Array.isArray(value) && value.every((id) => typeof id === "string")) ids = value;
    } catch { /* O estado local cobre navegadores que não preservam o tipo customizado. */ }
    draggedRawIds.current = [];
    if (ids.length) void assignRaw(targetId, ids);
  }
  async function unlinkRaw(assetId: string, fileId: string) {
    await changed(async () => {
      await action({ action: "unlink_raw", assetId });
      onSelectedAssetIdsChange(selectedAssetIds.filter((id) => id !== assetId));
      setSelectedRawIds((previous) => previous.filter((id) => id !== fileId));
    }, fileId);
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
  async function loadMore(kind: SourceKind) {
    const token = nextPages[kind];
    if (!token) return;
    setLoadingMore(kind); setError("");
    try {
      const params = new URLSearchParams({ kind, pageToken: token });
      const page = await json<{ files: DriveFile[]; nextPageToken: string | null }>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-sources?${params}`, { cache: "no-store" }));
      setExtraSources((previous) => {
        const seen = new Set([...(payload?.workspace?.source_files[kind] ?? []), ...previous[kind]].map((file) => file.id));
        return { ...previous, [kind]: [...previous[kind], ...page.files.filter((file) => !seen.has(file.id))] };
      });
      setNextPages((previous) => ({ ...previous, [kind]: page.nextPageToken }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar mais brutos."); }
    finally { setLoadingMore(null); }
  }

  const workspace = payload?.workspace;
  const assetsById = useMemo(() => new Map((workspace?.assets ?? []).map((asset) => [asset.id, asset])), [workspace]);
  const linked = useMemo(() => new Map((workspace?.assets ?? []).filter((asset) => asset.role === "raw" && workspace?.raw_links.some((row) => row.asset_id === asset.id)).map((asset) => [asset.drive_file_id, asset.id])), [workspace]);
  const sources = useMemo(() => [
    ...(workspace?.source_files.script ?? []).concat(extraSources.script).map((file) => ({ file, source: "Roteiro" })),
    ...(workspace?.source_files.capture ?? []).concat(extraSources.capture).map((file) => ({ file, source: "Captação" })),
  ], [workspace, extraSources]);
  const files: FileItem[] = (workspace?.assets ?? []).filter((asset) => asset.role !== "raw" && asset.state === "active").map((asset) => ({
    id: asset.drive_file_id, assetId: asset.id, name: asset.name, mimeType: asset.mime_type, size: asset.size_bytes,
    url: asset.web_view_link, source: asset.role === "final" ? "Final" : "Preview",
  }));
  const current = workspace?.final_versions.find((item) => item.state === "current");
  const preview = selected ?? files.find((file) => file.assetId === initialAssetId) ?? files.find((file) => file.assetId === current?.asset_id) ?? files[0] ?? null;
  const currentTarget = targets.find((target) => target.id === activeTaskId);
  const targetSummaries = summaries.filter((summary) => summary.capture_task_id === payload?.context.captureTaskId);
  function linkedToTarget(targetId: string, fileId: string): boolean {
    const summary = targetSummaries.find((item) => item.creative_task_id === targetId);
    const source = targetId === activeTaskId ? workspace ?? summary : summary;
    if (!source) return false;
    const rawAsset = source.assets.find((asset) => asset.role === "raw" && asset.drive_file_id === fileId);
    return Boolean(rawAsset && source.raw_links.some((link) => link.asset_id === rawAsset.id));
  }
  const availableRaw = targetSummaries[0];
  const rawCountLabel = availableRaw?.available_raw_count == null
    ? `${sources.length} arquivo(s) exibido(s)`
    : `${sources.length} exibidos de ${availableRaw.available_raw_limited ? "≥" : ""}${Math.max(sources.length, availableRaw.available_raw_count)}`;

  return <div className="kb-modal-backdrop" onClick={onClose}><div className="tm tm-lg docprev-tm creative-drive-modal" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="tm-back tm-back-floating" onClick={onBack} aria-label="Voltar para o card"><BackArrowIcon /></button>
    <div className="tm-head tm-head-tone-purple"><span className="tm-head-ico" aria-hidden>▣</span><div className="tm-head-text"><strong className="docprev-title">Materiais · {currentTarget?.title ?? "Criativo"}</strong><span className="admin-sub">Drive · Preview e histórico de finais</span></div><button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button></div>
    <div className="tm-layout"><div className="tm-main creative-drive-main" ref={main}>
      {preview ? <div className="creative-drive-preview"><iframe key={preview.id} src={`https://drive.google.com/file/d/${encodeURIComponent(preview.id)}/preview`} title={`Preview de ${preview.name}`} loading="lazy" /><div className="creative-drive-preview-caption"><b>{preview.name}</b><span>{preview.source}</span>{preview.url ? <a href={preview.url} target="_blank" rel="noreferrer">Abrir no Drive ↗</a> : null}</div></div> : null}
      {workspace?.last_error || workspace?.source_error ? <p className="creative-drive-error" role="alert">{workspace?.last_error || workspace?.source_error}</p> : null}
      {!payload && !error ? <p className="admin-sub">Carregando materiais…</p> : null}
      {payload && (!workspace || workspace.status !== "ready") ? <button type="button" className="admin-btn primary" disabled={Boolean(busy)} onClick={() => void provision()}>{busy === "provision" ? "Preparando…" : "Preparar pastas do Criativo"}</button> : null}
      {workspace?.status === "ready" ? <>
        <section className="creative-drive-section"><div className="creative-drive-row"><strong>Brutos da captação</strong><small>{rawCountLabel}</small></div><p className="admin-sub">Selecione miniaturas e toque em uma pasta à direita, ou arraste uma ou várias miniaturas para a pasta do Criativo. Clique na imagem para ampliar. O bruto original fica na Captação. {workspace.capture_workspace?.daily_folder_id ? <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(workspace.capture_workspace.daily_folder_id)}`} target="_blank" rel="noreferrer">Abrir a diária no Drive ↗</a> : null}</p>
          {selectedRawIds.length ? <p className="creative-drive-selected" role="status">{selectedRawIds.length} bruto(s) selecionado(s). Toque em uma pasta de Criativo para classificar.</p> : null}
          {notice ? <p className="creative-drive-selected" role="status">{notice}</p> : null}
          <div className="creative-drive-gallery">{sources.map(({ file, source }, index) => {
            const isMedia = file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/");
            const checked = selectedRawIds.includes(file.id);
            const kind = file.mimeType.startsWith("video/") ? "Vídeo" : file.mimeType.startsWith("image/") ? "Foto" : "Arquivo";
            return <div className={`creative-drive-tile${checked ? " selected" : ""}`} key={`${source}-${file.id}`} data-drive-file-id={file.id}
              draggable={!busy} onDragStart={(event) => {
                const ids = checked ? selectedRawIds : [file.id];
                draggedRawIds.current = ids;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-north-raw-ids", JSON.stringify(ids));
              }} onDragEnd={() => { draggedRawIds.current = []; }}>
              <input type="checkbox" aria-label={`Selecionar bruto ${file.name}`} checked={checked} disabled={Boolean(busy)} onChange={() => toggleRaw(file.id)} />
              <button type="button" className="creative-drive-tile-preview" aria-label={`Ampliar ${file.name}`} onClick={() => { setSelected({ id: file.id, name: file.name, mimeType: file.mimeType, size: null, url: file.webViewLink, source }); main.current?.scrollTo({ top: 0, behavior: "smooth" }); main.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" }); }}>
                <span className={`creative-drive-tile-art${file.mimeType.startsWith("video/") ? " video" : ""}`} aria-hidden>{isMedia ? <img src={file.thumbnailUrl ?? `/api/admin/drive/thumbnail/${encodeURIComponent(file.id)}`} alt="" loading="lazy" onError={(event) => { const image = event.currentTarget; if (file.thumbnailUrl && !image.dataset.fallback) { image.dataset.fallback = "1"; image.src = `/api/admin/drive/thumbnail/${encodeURIComponent(file.id)}`; } else image.style.display = "none"; }} /> : null}<span>{file.mimeType.startsWith("video/") ? "▶" : file.mimeType.startsWith("image/") ? "▧" : "▤"}</span></span>
                <span className="creative-drive-tile-caption"><b>{kind} {index + 1}</b><small>{source}{linked.get(file.id) ? " · vinculado aqui" : ""}</small></span>
              </button>
              {linked.get(file.id) ? <button type="button" className="creative-drive-tile-unlink" disabled={Boolean(busy)} onClick={() => void unlinkRaw(linked.get(file.id)!, file.id)}>Remover vínculo</button> : null}
            </div>;
          })}</div>
          {nextPages.script ? <button type="button" className="admin-btn ghost" disabled={Boolean(loadingMore || busy)} onClick={() => void loadMore("script")}>{loadingMore === "script" ? "Carregando…" : "Carregar mais do Roteiro"}</button> : null}
          {nextPages.capture ? <button type="button" className="admin-btn ghost" disabled={Boolean(loadingMore || busy)} onClick={() => void loadMore("capture")}>{loadingMore === "capture" ? "Carregando…" : "Carregar mais da Captação"}</button> : null}
          {!sources.length && !workspace.source_error ? <p className="admin-sub">Nenhum bruto encontrado nesta diária.</p> : null}
        </section>
        <section className="creative-drive-section"><div className="creative-drive-row"><strong>Preview</strong><button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => input.current?.click()}>{busy === "upload" ? "Enviando…" : "Enviar arquivo"}</button><input ref={input} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
          {files.map((file) => <div className="creative-drive-file" key={file.assetId}><input type="checkbox" checked={selectedAssetIds.includes(file.assetId!)} aria-label={`Anexar ${file.name} ao comentário`} onChange={() => onSelectedAssetIdsChange(selectedAssetIds.includes(file.assetId!) ? selectedAssetIds.filter((id) => id !== file.assetId) : [...selectedAssetIds, file.assetId!])} /><button type="button" className="creative-drive-file-name" onClick={() => setSelected(file)}><b>{file.name}</b><small>{file.source}</small></button>{file.source === "Preview" ? <button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void version("promote", file.assetId!)}>Promover</button> : null}</div>)}
          {!files.length ? <p className="admin-sub">Envie o primeiro Preview.</p> : null}
        </section>
      </> : null}
    </div><aside className="tm-side creative-drive-side">
      {targets.length ? <section className="tm-box docprev-cellbox" ref={targetRail}><p className="tm-box-label">Pastas dos Criativos</p><p className="admin-sub">Arraste brutos para a pasta, ou selecione as miniaturas e toque nela.</p><div className="creative-drive-targets">{targets.map((target) => <div key={target.id} className={`creative-drive-target${target.id === activeTaskId ? " on" : ""}`}
        onDragOver={(event) => { if (!draggedRawIds.current.length) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDrop={(event) => dropRaw(event, target.id)}>
        <button type="button" className="creative-drive-target-assign" disabled={Boolean(busy)} onClick={() => selectedRawIds.length ? void assignRaw(target.id) : setActiveTaskId(target.id)} aria-label={`${selectedRawIds.length ? "Classificar brutos em" : "Abrir pasta"} ${target.title}`}><span aria-hidden>▣</span><span><b>{target.title}</b><small>{targetSummaries.find((summary) => summary.creative_task_id === target.id)?.raw_links.length ?? 0} bruto(s) vinculado(s)</small></span></button>
        <button type="button" className="creative-drive-target-open" disabled={Boolean(busy)} onClick={() => setActiveTaskId(target.id)}>Abrir</button>
      </div>)}</div></section> : null}
      <section className="tm-box docprev-cellbox"><p className="tm-box-label">Detalhes</p><div className="docprev-cells"><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Arquivo</span><span className="tm-cell-static docprev-cell-wrap">{preview?.name ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Origem</span><span className="tm-cell-static">{preview?.source ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Formato</span><span className="tm-cell-static docprev-cell-wrap">{preview?.mimeType ?? "—"}</span></div></div>{preview?.size != null ? <div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Tamanho</span><span className="tm-cell-static">{formatFileSize(preview.size)}</span></div></div> : null}</div></section>
      {workspace?.final_versions.length ? <section className="tm-box docprev-cellbox"><p className="tm-box-label">Histórico de finais</p><div className="creative-drive-history">{workspace.final_versions.map((item) => { const asset = assetsById.get(item.asset_id); return <div className="creative-drive-history-row" key={item.id}><button type="button" onClick={() => asset && setSelected({ id: asset.drive_file_id, assetId: asset.id, name: asset.name, mimeType: asset.mime_type, size: asset.size_bytes, url: asset.web_view_link, source: `Final v${item.version_number}` })}><b>v{item.version_number} · {asset?.name ?? "Arquivo"}</b><small>{item.state === "current" ? "Atual" : item.state === "trashed" ? "Removida" : "Anterior"}</small></button><button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => void version(item.state === "trashed" ? "restore_final" : "trash_final", item.id)}>{item.state === "trashed" ? "Restaurar" : "Remover"}</button></div>; })}</div></section> : null}
    </aside></div>
    {error || notice || busy === "assign" ? <div className={`creative-drive-toast${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || (busy === "assign" ? "Classificando brutos…" : notice)}</div> : null}
    <footer className="kb-modal-actions"><span>{selectedRawIds.length ? `${selectedRawIds.length} bruto(s) para classificar` : selectedAssetIds.length ? `${selectedAssetIds.length} arquivo(s) para o próximo comentário` : ""}</span><span />{selectedRawIds.length ? <button type="button" className="admin-btn primary" onClick={() => targetRail.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Escolher pasta</button> : null}<button type="button" className="admin-btn ghost" onClick={onBack}>Voltar ao card</button></footer>
  </div></div>;
}
