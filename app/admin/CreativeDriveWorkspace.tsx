"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { CreativeDriveContext, CreativeDriveWorkspace as Workspace } from "@/lib/creativeDrive";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import type { DriveFile } from "@/lib/googleDrive";
import { formatFileSize } from "@/lib/documentFiles";
import { driveDisplayName, driveShotLabel, sortDriveFiles } from "@/lib/drivePresentation";
import BackArrowIcon from "./BackArrowIcon";

type Payload = { context: CreativeDriveContext; workspace: Workspace | null };
type Target = { id: string; title: string };
type FileItem = { id: string; name: string; mimeType: string; size: number | null; url: string | null; source: string; assetId?: string };
type SourceKind = "script" | "capture";
type SourcePages = Record<SourceKind, string | null>;
type MaterialTab = "raw" | "classified" | "preview" | "final";
type RawFilter = "pending" | "all" | "linked";
const RAW_PAGE_SIZE = 24;
const ASSET_PAGE_SIZE = 12;
const emptySources = (): Record<SourceKind, DriveFile[]> => ({ script: [], capture: [] });
const emptyPages = (): SourcePages => ({ script: null, capture: null });

function Pagination({ page, total, onPrevious, onNext, hasMore = false, busy = false }: { page: number; total: number; onPrevious: () => void; onNext: () => void; hasMore?: boolean; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total));
  return <nav className="creative-drive-pagination" aria-label="Paginação de materiais"><button type="button" className="admin-btn ghost" disabled={page === 1 || busy} onClick={onPrevious}>Anterior</button><span>Página {page} de {hasMore ? `${pages}+` : pages}</span><button type="button" className="admin-btn ghost" disabled={(page >= pages && !hasMore) || busy} onClick={onNext}>Próxima</button></nav>;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body;
}

export default function CreativeDriveWorkspace({ taskId, targets, summaries, initialAssetId, initialTab = "raw", selectedAssetIds, onSelectedAssetIdsChange, onChanged, onBack, onClose }: {
  taskId: string;
  targets: Target[];
  summaries: CreativeMaterialWorkspace[];
  initialAssetId?: string | null;
  initialTab?: MaterialTab;
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
  const [noticeTargetId, setNoticeTargetId] = useState<string | null>(null);
  const [rawTargetId, setRawTargetId] = useState(taskId);
  const [rawFilter, setRawFilter] = useState<RawFilter>("pending");
  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">("oldest");
  const [recentLinks, setRecentLinks] = useState<Record<string, string[]>>({});
  const rawAnchor = useRef<string | null>(null);
  const previewAnchor = useRef<string | null>(null);
  const [extraSources, setExtraSources] = useState(emptySources);
  const [nextPages, setNextPages] = useState<SourcePages>(emptyPages);
  const [loadingMore, setLoadingMore] = useState<SourceKind | null>(null);
  const [searchText, setSearchText] = useState("");
  const [rawQuery, setRawQuery] = useState("");
  const [searchSources, setSearchSources] = useState(emptySources);
  const [searchPages, setSearchPages] = useState<SourcePages>(emptyPages);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRequest = useRef(0);
  const sourceRequest = useRef(0);
  const [activeTab, setActiveTab] = useState<MaterialTab>(initialAssetId ? "classified" : initialTab);
  const [rawPage, setRawPage] = useState(1);
  const [classifiedPage, setClassifiedPage] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);
  const [finalPage, setFinalPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const targetRail = useRef<HTMLElement>(null);
  const draggedRawIds = useRef<string[]>([]);
  const workspaceRequest = useRef(0);

  const load = useCallback(async (preserveSources = false) => {
    const requestId = ++workspaceRequest.current;
    const next = await json<Payload>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-workspace${preserveSources ? "?sources=0" : ""}`, { cache: "no-store" }));
    if (requestId !== workspaceRequest.current) return;
    setPayload((previous) => preserveSources && previous?.workspace && next.workspace ? { ...next, workspace: { ...next.workspace, source_files: previous.workspace.source_files, source_next_page_token: previous.workspace.source_next_page_token, source_error: previous.workspace.source_error } } : next);
    if (initialAssetId && !preserveSources) {
      const asset = next.workspace?.assets.find((item) => item.id === initialAssetId);
      if (asset) setActiveTab(asset.role === "raw" ? "classified" : asset.role === "final" ? "final" : "preview");
    }
    if (!preserveSources) {
      setExtraSources(emptySources());
      setNextPages(next.workspace?.source_next_page_token ?? emptyPages());
    }
  }, [activeTaskId, initialAssetId]);
  useEffect(() => {
    setPayload(null); setSelected(null); setError(""); setExtraSources(emptySources()); setNextPages(emptyPages());
    setRawTargetId(activeTaskId); setRawFilter("pending"); setSelectedRawIds([]); rawAnchor.current = null;
    searchRequest.current += 1; setSearchText(""); setRawQuery(""); setSearchSources(emptySources()); setSearchPages(emptyPages());
    setRawPage(1); setClassifiedPage(1); setPreviewPage(1); setFinalPage(1);
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar o Drive."));
    return () => { workspaceRequest.current += 1; searchRequest.current += 1; sourceRequest.current += 1; };
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
  function selectRaw(event: MouseEvent<HTMLElement>, id: string) {
    if (event.shiftKey && rawAnchor.current) {
      const first = visibleSources.findIndex(({ file }) => file.id === rawAnchor.current);
      const last = visibleSources.findIndex(({ file }) => file.id === id);
      if (first >= 0 && last >= 0) {
        const range = visibleSources.slice(Math.min(first, last), Math.max(first, last) + 1).map(({ file }) => file.id);
        setSelectedRawIds(event.ctrlKey || event.metaKey ? (previous) => [...new Set([...previous, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) setSelectedRawIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    else setSelectedRawIds([id]);
    rawAnchor.current = id;
  }
  function selectPreview(event: MouseEvent<HTMLElement>, id: string) {
    if (event.shiftKey && previewAnchor.current) {
      const first = previewAssets.findIndex((asset) => asset.id === previewAnchor.current);
      const last = previewAssets.findIndex((asset) => asset.id === id);
      if (first >= 0 && last >= 0) {
        const range = previewAssets.slice(Math.min(first, last), Math.max(first, last) + 1).map((asset) => asset.id);
        onSelectedAssetIdsChange(event.ctrlKey || event.metaKey ? [...new Set([...selectedAssetIds, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) onSelectedAssetIdsChange(selectedAssetIds.includes(id) ? selectedAssetIds.filter((item) => item !== id) : [...selectedAssetIds, id]);
    else onSelectedAssetIdsChange([id]);
    previewAnchor.current = id;
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
      setRecentLinks((previous) => ({ ...previous, [targetId]: [...new Set([...(previous[targetId] ?? []), ...filesToAssign.map(({ file }) => file.id)])] }));
      setNotice(created ? `${created} bruto(s) vinculado(s) a ${targetName}.` : `Esses brutos já estão em ${targetName}.`);
      setNoticeTargetId(targetId);
      setSelectedRawIds([]);
      rawAnchor.current = null;
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
    setBusy(fileId); setError(""); setNotice("");
    try {
      await action({ action: "unlink_raw", assetId });
      onSelectedAssetIdsChange(selectedAssetIds.filter((id) => id !== assetId));
      setSelectedRawIds((previous) => previous.filter((id) => id !== fileId));
      setSelected((previous) => previous?.assetId === assetId ? null : previous);
      await load(true);
      onChanged();
      setRecentLinks((previous) => ({ ...previous, [activeTaskId]: (previous[activeTaskId] ?? []).filter((id) => id !== fileId) }));
      setNotice("Vínculo removido deste Criativo. O bruto original continua na Captação.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao desassociar o bruto."); }
    finally { setBusy(""); }
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
    const requestId = sourceRequest.current;
    const token = rawQuery ? searchPages[kind] : nextPages[kind];
    if (!token) return null;
    setLoadingMore(kind); setError("");
    try {
      const params = new URLSearchParams({ kind, pageToken: token });
      if (rawQuery) params.set("query", rawQuery);
      const page = await json<{ files: DriveFile[]; nextPageToken: string | null }>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-sources?${params}`, { cache: "no-store" }));
      if (requestId !== sourceRequest.current) return null;
      const updateSources = rawQuery ? setSearchSources : setExtraSources;
      updateSources((previous) => {
        const seen = new Set([...(rawQuery ? [] : payload?.workspace?.source_files[kind] ?? []), ...previous[kind]].map((file) => file.id));
        return { ...previous, [kind]: [...previous[kind], ...page.files.filter((file) => !seen.has(file.id))] };
      });
      (rawQuery ? setSearchPages : setNextPages)((previous) => ({ ...previous, [kind]: page.nextPageToken }));
      return page.files;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar mais brutos."); return null; }
    finally { setLoadingMore(null); }
  }

  async function nextRawPage() {
    if (rawPage * RAW_PAGE_SIZE < visibleSources.length) { setRawPage((page) => page + 1); return; }
    const pages = rawQuery ? searchPages : nextPages;
    const kind = pages.script ? "script" : pages.capture ? "capture" : null;
    if (!kind) return;
    const loaded = await loadMore(kind);
    if (loaded && visibleSources.length + loaded.filter((file) => rawFilter === "all" || (rawFilter === "linked") === linkedToTarget(rawTargetId, file.id)).length > rawPage * RAW_PAGE_SIZE) setRawPage((page) => page + 1);
  }

  async function searchRaws(query: string) {
    const trimmed = query.trim();
    const requestId = ++searchRequest.current;
    sourceRequest.current += 1;
    setRawPage(1); setSelected(null); setSelectedRawIds([]); setError("");
    if (!trimmed) { setRawQuery(""); setSearchSources(emptySources()); setSearchPages(emptyPages()); return; }
    if (trimmed.length < 2) { setError("Digite pelo menos 2 caracteres para buscar."); return; }
    setSearchBusy(true);
    try {
      const workspace = payload?.workspace;
      const kinds: SourceKind[] = (["script", "capture"] as const).filter((kind) => Boolean(kind === "script" ? workspace?.capture_workspace?.script_folder_id : workspace?.capture_workspace?.capture_folder_id));
      const results = await Promise.all(kinds.map(async (kind) => {
        const params = new URLSearchParams({ kind, query: trimmed });
        return { kind, page: await json<{ files: DriveFile[]; nextPageToken: string | null }>(await fetch(`/api/admin/tasks/${activeTaskId}/drive-sources?${params}`, { cache: "no-store" })) };
      }));
      if (requestId !== searchRequest.current) return;
      const files = emptySources(); const pages = emptyPages();
      for (const result of results) { files[result.kind] = result.page.files; pages[result.kind] = result.page.nextPageToken; }
      setRawQuery(trimmed); setSearchSources(files); setSearchPages(pages);
    } catch (cause) {
      if (requestId === searchRequest.current) setError(cause instanceof Error ? cause.message : "Falha ao buscar brutos.");
    } finally { if (requestId === searchRequest.current) setSearchBusy(false); }
  }

  const workspace = payload?.workspace;
  const assetsById = useMemo(() => new Map((workspace?.assets ?? []).map((asset) => [asset.id, asset])), [workspace]);
  const allSources = useMemo(() => [
    ...(workspace?.source_files.script ?? []).map((file) => ({ file, source: "Roteiro" })),
    ...(workspace?.source_files.capture ?? []).map((file) => ({ file, source: "Captação" })),
    ...extraSources.script.map((file) => ({ file, source: "Roteiro" })),
    ...extraSources.capture.map((file) => ({ file, source: "Captação" })),
  ], [workspace, extraSources]);
  const sources = useMemo(() => rawQuery ? [
    ...searchSources.script.map((file) => ({ file, source: "Roteiro" })),
    ...searchSources.capture.map((file) => ({ file, source: "Captação" })),
  ] : allSources, [rawQuery, searchSources, allSources]);
  const sourceById = useMemo(() => new Map(allSources.map(({ file }) => [file.id, file])), [allSources]);
  const orderedSources = useMemo(() => sortDriveFiles(sources.map(({ file, source }) => ({ ...file, source })), sortOrder).map(({ source, ...file }) => ({ file, source })), [sources, sortOrder]);
  const linkedAssetIds = useMemo(() => new Set((workspace?.raw_links ?? []).map((link) => link.asset_id)), [workspace]);
  const classifiedRows = (workspace?.assets ?? []).filter((asset) => asset.role === "raw" && asset.state === "active" && linkedAssetIds.has(asset.id));
  const classifiedByFile = new Map(classifiedRows.map((asset) => [asset.drive_file_id, asset]));
  const classifiedAssets = sortDriveFiles(classifiedRows.map((asset) => sourceById.get(asset.drive_file_id) ?? { id: asset.drive_file_id, name: asset.name, mimeType: asset.mime_type, thumbnailUrl: null, webViewLink: asset.web_view_link, createdTime: asset.created_at }), sortOrder).map((file) => classifiedByFile.get(file.id)!).filter(Boolean);
  const previewAssets = (workspace?.assets ?? []).filter((asset) => asset.role === "preview" && asset.state === "active");
  const finalVersions = workspace?.final_versions ?? [];
  useEffect(() => { setClassifiedPage((page) => Math.min(page, Math.max(1, Math.ceil(classifiedAssets.length / ASSET_PAGE_SIZE)))); }, [classifiedAssets.length]);
  useEffect(() => { setPreviewPage((page) => Math.min(page, Math.max(1, Math.ceil(previewAssets.length / ASSET_PAGE_SIZE)))); }, [previewAssets.length]);
  useEffect(() => { setFinalPage((page) => Math.min(page, Math.max(1, Math.ceil(finalVersions.length / ASSET_PAGE_SIZE)))); }, [finalVersions.length]);
  const files: FileItem[] = (workspace?.assets ?? []).filter((asset) => asset.state === "active" && (asset.role !== "raw" || linkedAssetIds.has(asset.id))).map((asset, index) => ({
    id: asset.drive_file_id, assetId: asset.id, name: driveDisplayName(sourceById.get(asset.drive_file_id) ?? { name: asset.name, originalFilename: null }, `${asset.mime_type.startsWith("video/") ? "Vídeo" : asset.mime_type.startsWith("image/") ? "Foto" : "Arquivo"} ${index + 1}`), mimeType: asset.mime_type, size: asset.size_bytes,
    url: asset.web_view_link, source: asset.role === "final" ? "Final" : asset.role === "raw" ? "Bruto classificado" : "Preview",
  }));
  const current = workspace?.final_versions.find((item) => item.state === "current");
  const initialFile = files.find((file) => file.assetId === initialAssetId);
  const preview = selected ?? (activeTab === "classified" && initialFile?.source === "Bruto classificado" ? initialFile : null)
    ?? (activeTab === "final" ? (initialFile?.source === "Final" ? initialFile : files.find((file) => file.assetId === current?.asset_id)) : null)
    ?? (activeTab === "preview" ? (initialFile?.source === "Preview" ? initialFile : files.find((file) => file.source === "Preview")) : null) ?? null;
  const currentTarget = targets.find((target) => target.id === activeTaskId);
  const targetSummaries = summaries.filter((summary) => summary.capture_task_id === payload?.context.captureTaskId);
  function linkedToTarget(targetId: string, fileId: string): boolean {
    if (recentLinks[targetId]?.includes(fileId)) return true;
    const summary = targetSummaries.find((item) => item.creative_task_id === targetId);
    const source = targetId === activeTaskId ? workspace ?? summary : summary;
    if (!source) return false;
    const rawAsset = source.assets.find((asset) => asset.role === "raw" && asset.state === "active" && asset.drive_file_id === fileId);
    return Boolean(rawAsset && source.raw_links.some((link) => link.asset_id === rawAsset.id));
  }
  const previewIsRaw = preview?.source === "Roteiro" || preview?.source === "Captação" || preview?.source === "Bruto classificado";
  const previewLinks = preview && previewIsRaw ? targets.filter((target) => linkedToTarget(target.id, preview.id)) : [];
  const visibleSources = orderedSources.filter(({ file }) => rawFilter === "all" || (rawFilter === "linked") === linkedToTarget(rawTargetId, file.id));
  const rawTarget = targets.find((target) => target.id === rawTargetId);
  useEffect(() => { setRawPage((page) => Math.min(page, Math.max(1, Math.ceil(visibleSources.length / RAW_PAGE_SIZE)))); }, [visibleSources.length]);
  function chooseRawTarget(targetId: string) {
    setRawTargetId(targetId); setRawFilter("pending"); setActiveTab("raw"); setRawPage(1); setSelectedRawIds([]); setSelected(null); rawAnchor.current = null;
  }
  const hasMoreSources = Boolean((rawQuery ? searchPages : nextPages).script || (rawQuery ? searchPages : nextPages).capture);
  const rawCountLabel = `${visibleSources.length} ${rawFilter === "linked" ? "classificados" : rawFilter === "pending" ? "pendentes" : "arquivos"} · ${sources.length}${hasMoreSources ? "+" : ""} no Drive`;

  return <div className="kb-modal-backdrop" onClick={onClose}><div className="tm tm-lg docprev-tm creative-drive-modal" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="tm-back tm-back-floating" onClick={onBack} aria-label="Voltar para o card"><BackArrowIcon /></button>
    <div className="tm-head tm-head-tone-purple"><span className="tm-head-ico" aria-hidden>▣</span><div className="tm-head-text"><strong className="docprev-title">Materiais · {activeTab === "raw" ? rawTarget?.title ?? currentTarget?.title ?? "Criativo" : currentTarget?.title ?? "Criativo"}</strong><span className="admin-sub">Drive · Preview e histórico de finais</span></div><button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button></div>
    {error || notice || busy === "assign" ? <div className={`creative-drive-toast${error ? " error" : ""}`} role={error ? "alert" : "status"}><span>{error || (busy === "assign" ? "Classificando brutos…" : notice)}</span>{notice && noticeTargetId && !error ? <button type="button" onClick={() => { setActiveTaskId(noticeTargetId); setActiveTab("classified"); setNotice(""); }}>Ver pasta</button> : null}</div> : null}
    <div className="tm-layout"><div className="tm-main creative-drive-main" ref={main}>
      {preview ? <div className="creative-drive-preview">
        {previewLinks.length ? <div className="creative-drive-preview-links" aria-label="Entregas vinculadas ao bruto"><span className="creative-drive-preview-links-label">Vinculado a</span>{previewLinks.map((target) => <span className="creative-drive-preview-eyebrow" key={target.id} title={target.title}>{target.title}</span>)}</div> : null}
        <iframe key={preview.id} src={`https://drive.google.com/file/d/${encodeURIComponent(preview.id)}/preview`} title={`Preview de ${preview.name}`} loading="lazy" /><div className="creative-drive-preview-caption"><b>{preview.name}</b><span>{preview.source}</span>{preview.url ? <a href={preview.url} target="_blank" rel="noreferrer">Abrir no Drive ↗</a> : null}</div></div> : null}
      {workspace?.last_error || (activeTab === "raw" && workspace?.source_error) ? <p className="creative-drive-error" role="alert">{workspace?.last_error || workspace?.source_error}</p> : null}
      {!payload && !error ? <p className="admin-sub">Carregando materiais…</p> : null}
      {payload && (!workspace || workspace.status !== "ready") ? <button type="button" className="admin-btn primary" disabled={Boolean(busy)} onClick={() => void provision()}>{busy === "provision" ? "Preparando…" : "Preparar pastas do Criativo"}</button> : null}
      {workspace?.status === "ready" ? <>
        <nav className="creative-drive-tabs" aria-label="Tipos de materiais">{([ ["raw", "Brutos da captação", null], ["classified", "Classificados", classifiedAssets.length], ["preview", "Previews", previewAssets.length], ["final", "Finais", finalVersions.length] ] as const).map(([tab, label, count]) => <button type="button" key={tab} className={activeTab === tab ? "on" : ""} aria-current={activeTab === tab ? "page" : undefined} onClick={() => { setActiveTab(tab); setSelected(null); }}>{label}{count !== null ? <small>{count}</small> : null}</button>)}</nav>
        {activeTab === "raw" ? <section className="creative-drive-section"><div className="creative-drive-row"><strong>Brutos da captação</strong><small>{rawCountLabel}</small></div><div className="creative-drive-raw-controls"><div className="creative-drive-raw-target">Para <strong>{rawTarget?.title ?? currentTarget?.title ?? "Criativo"}</strong></div><nav className="creative-drive-raw-filters" aria-label="Filtrar brutos">{([["pending", "Pendentes"], ["all", "Todos"], ["linked", "Já classificados"]] as const).map(([filter, label]) => <button type="button" key={filter} className={rawFilter === filter ? "on" : ""} aria-pressed={rawFilter === filter} onClick={() => { setRawFilter(filter); setRawPage(1); setSelectedRawIds([]); rawAnchor.current = null; }}>{label}</button>)}</nav><label className="creative-drive-sort">Ordem <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as "oldest" | "newest"); setRawPage(1); }}><option value="oldest">Cronológica · antigas primeiro</option><option value="newest">Cronológica · recentes primeiro</option></select></label></div><form className="creative-drive-search" onSubmit={(event) => { event.preventDefault(); void searchRaws(searchText); }}><label htmlFor="creative-drive-raw-search">Encontrar bruto pelo nome</label><div><input id="creative-drive-raw-search" type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Nome ou código do arquivo" /><button type="submit" className="admin-btn ghost" disabled={searchBusy}>{searchBusy ? "Buscando…" : "Buscar"}</button>{rawQuery ? <button type="button" className="admin-btn ghost" onClick={() => { setSearchText(""); void searchRaws(""); }}>Limpar</button> : null}</div></form><p className="admin-sub">Clique para selecionar; Ctrl/Cmd adiciona, Shift seleciona um intervalo. Arraste para uma pasta à direita. A ordem usa a captura quando disponível e a criação no Drive como referência. {workspace.capture_workspace?.daily_folder_id ? <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(workspace.capture_workspace.daily_folder_id)}`} target="_blank" rel="noreferrer">Abrir a diária no Drive ↗</a> : null}</p>
          {selectedRawIds.length ? <p className="creative-drive-selected" role="status">{selectedRawIds.length} bruto(s) selecionado(s). Use Classificar na pasta desejada ou arraste a seleção.</p> : null}
          <div className="creative-drive-gallery raw">{visibleSources.slice((rawPage - 1) * RAW_PAGE_SIZE, rawPage * RAW_PAGE_SIZE).map(({ file, source }, index) => {
            const isMedia = file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/");
            const checked = selectedRawIds.includes(file.id);
            const kind = file.mimeType.startsWith("video/") ? "Vídeo" : file.mimeType.startsWith("image/") ? "Foto" : "Arquivo";
            const displayName = driveDisplayName(file, `${kind} ${(rawPage - 1) * RAW_PAGE_SIZE + index + 1}`);
            const isLinked = linkedToTarget(rawTargetId, file.id);
            return <div className={`creative-drive-tile${checked ? " selected" : ""}`} key={`${source}-${file.id}`} data-drive-file-id={file.id}
              draggable={!busy} onDragStart={(event) => {
                const ids = checked ? selectedRawIds : [file.id];
                if (!checked) setSelectedRawIds(ids);
                draggedRawIds.current = ids;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-north-raw-ids", JSON.stringify(ids));
              }} onDragEnd={() => { draggedRawIds.current = []; }}>
              <button type="button" className="creative-drive-tile-preview" disabled={Boolean(busy)} aria-pressed={checked} aria-label={`Selecionar ${displayName}`} onClick={(event) => {
                selectRaw(event, file.id);
                setSelected({ id: file.id, name: displayName, mimeType: file.mimeType, size: null, url: file.webViewLink, source });
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey) requestAnimationFrame(() => main.current?.querySelector(".creative-drive-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }} onDoubleClick={() => { setSelected({ id: file.id, name: displayName, mimeType: file.mimeType, size: null, url: file.webViewLink, source }); main.current?.scrollTo({ top: 0, behavior: "smooth" }); }}>
                <span className={`creative-drive-tile-art${file.mimeType.startsWith("video/") ? " video" : ""}`} aria-hidden>{isMedia ? <img src={file.thumbnailUrl ?? `/api/admin/drive/thumbnail/${encodeURIComponent(file.id)}`} alt="" loading="lazy" onError={(event) => { const image = event.currentTarget; if (file.thumbnailUrl && !image.dataset.fallback) { image.dataset.fallback = "1"; image.src = `/api/admin/drive/thumbnail/${encodeURIComponent(file.id)}`; } else image.style.display = "none"; }} /> : null}<span>{file.mimeType.startsWith("video/") ? "▶" : file.mimeType.startsWith("image/") ? "▧" : "▤"}</span></span>
                <span className="creative-drive-tile-caption"><b title={displayName}>{displayName}</b><small>{driveShotLabel(file)}</small></span>
              </button>
              <button type="button" className="creative-drive-tile-open" aria-label={`Ampliar ${displayName}`} onClick={() => { setSelected({ id: file.id, name: displayName, mimeType: file.mimeType, size: null, url: file.webViewLink, source }); main.current?.scrollTo({ top: 0, behavior: "smooth" }); }}>↗</button>
              {isLinked ? <span className="creative-drive-linked" title={`Classificado em ${rawTarget?.title ?? "este Criativo"}`}>Nesta pasta</span> : null}
            </div>;
          })}</div>
          {visibleSources.length || hasMoreSources ? <Pagination page={rawPage} total={Math.ceil(visibleSources.length / RAW_PAGE_SIZE)} hasMore={hasMoreSources} busy={Boolean(loadingMore || busy)} onPrevious={() => setRawPage((page) => page - 1)} onNext={() => void nextRawPage()} /> : <p className="creative-drive-empty">{rawFilter === "pending" ? "Nenhum bruto pendente para este Criativo. Veja Todos ou escolha outra pasta." : rawFilter === "linked" ? "Nenhum bruto classificado neste Criativo." : rawQuery ? "Nenhum bruto encontrado nesta Captação." : "Nenhum bruto nesta diária."}</p>}
        </section> : null}
        {activeTab === "classified" ? <section className="creative-drive-section"><div className="creative-drive-row"><strong>Brutos classificados em {currentTarget?.title ?? "este Criativo"}</strong><small>{classifiedAssets.length} vínculo(s)</small></div><p className="admin-sub">Cada arquivo abaixo é um atalho. Desassociar remove apenas o vínculo deste Criativo; o original permanece na Captação.</p>
          <div className="creative-drive-gallery curated">{classifiedAssets.slice((classifiedPage - 1) * ASSET_PAGE_SIZE, classifiedPage * ASSET_PAGE_SIZE).map((asset, index) => { const source = sourceById.get(asset.drive_file_id); const displayName = driveDisplayName(source ?? { name: asset.name, originalFilename: null }, `${asset.mime_type.startsWith("video/") ? "Vídeo" : "Foto"} ${(classifiedPage - 1) * ASSET_PAGE_SIZE + index + 1}`); return <div className="creative-drive-tile" key={asset.id} data-classified-asset-id={asset.id}><button type="button" className="creative-drive-tile-preview" onClick={() => { setSelected(files.find((file) => file.assetId === asset.id) ?? null); main.current?.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Visualizar bruto classificado ${displayName}`}><span className={`creative-drive-tile-art${asset.mime_type.startsWith("video/") ? " video" : ""}`} aria-hidden><img src={`/api/admin/drive/thumbnail/${encodeURIComponent(asset.drive_file_id)}`} alt="" loading="lazy" /><span>{asset.mime_type.startsWith("video/") ? "▶" : "▧"}</span></span><span className="creative-drive-tile-caption"><b title={displayName}>{displayName}</b><small>{source ? driveShotLabel(source) : "Bruto da captação"}</small></span></button><div className="creative-drive-tile-actions"><a className="creative-drive-download" href={`/api/admin/tasks/${activeTaskId}/drive-assets/${asset.id}/download`}>↓ Baixar</a><details className="creative-drive-options"><summary>Drive ▾</summary><div><a href={asset.web_view_link ?? `https://drive.google.com/file/d/${encodeURIComponent(asset.drive_file_id)}/view`} target="_blank" rel="noreferrer">Abrir no Drive ↗</a><button type="button" disabled={Boolean(busy)} onClick={() => void unlinkRaw(asset.id, asset.drive_file_id)}>Desassociar</button></div></details></div></div>; })}</div>
          {classifiedAssets.length ? <Pagination page={classifiedPage} total={Math.ceil(classifiedAssets.length / ASSET_PAGE_SIZE)} onPrevious={() => setClassifiedPage((page) => page - 1)} onNext={() => setClassifiedPage((page) => page + 1)} /> : <p className="admin-sub">Nenhum bruto classificado neste Criativo.</p>}
        </section> : null}
        {activeTab === "preview" ? <section className="creative-drive-section"><div className="creative-drive-row"><strong>Previews de {currentTarget?.title ?? "este Criativo"}</strong><button type="button" className="admin-btn ghost" disabled={Boolean(busy)} onClick={() => input.current?.click()}>{busy === "upload" ? "Enviando…" : "Enviar arquivo"}</button><input ref={input} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
          {previewAssets.length ? <p className="admin-sub">Clique para anexar ao próximo comentário; Ctrl/Cmd seleciona vários. Use ↗ para ampliar.</p> : null}
          <div className="creative-drive-gallery curated">{previewAssets.slice((previewPage - 1) * ASSET_PAGE_SIZE, previewPage * ASSET_PAGE_SIZE).map((asset, index) => { const displayName = driveDisplayName({ name: asset.name, originalFilename: null }, `Preview ${(previewPage - 1) * ASSET_PAGE_SIZE + index + 1}`); const chosen = selectedAssetIds.includes(asset.id); return <div className={`creative-drive-tile${chosen ? " selected" : ""}`} key={asset.id}><button type="button" className="creative-drive-tile-preview" aria-pressed={chosen} aria-label={`Anexar ${displayName} ao comentário`} onClick={(event) => selectPreview(event, asset.id)}><span className={`creative-drive-tile-art${asset.mime_type.startsWith("video/") ? " video" : ""}`} aria-hidden><img src={`/api/admin/drive/thumbnail/${encodeURIComponent(asset.drive_file_id)}`} alt="" loading="lazy" /><span>{asset.mime_type.startsWith("video/") ? "▶" : "▧"}</span></span><span className="creative-drive-tile-caption"><b title={displayName}>{displayName}</b><small>{chosen ? "Selecionado para comentário" : "Preview"}</small></span></button><button type="button" className="creative-drive-tile-open" aria-label={`Ampliar ${displayName}`} onClick={() => setSelected(files.find((file) => file.assetId === asset.id) ?? null)}>↗</button><div className="creative-drive-tile-actions"><button type="button" className="creative-drive-promote" disabled={Boolean(busy)} onClick={() => void version("promote", asset.id)}>Promover a final</button></div></div>; })}</div>
          {previewAssets.length ? <Pagination page={previewPage} total={Math.ceil(previewAssets.length / ASSET_PAGE_SIZE)} onPrevious={() => setPreviewPage((page) => page - 1)} onNext={() => setPreviewPage((page) => page + 1)} /> : <p className="admin-sub">Envie o primeiro Preview.</p>}
        </section> : null}
        {activeTab === "final" ? <section className="creative-drive-section"><div className="creative-drive-row"><strong>Histórico de finais</strong><small>{finalVersions.length} versão(ões)</small></div><div className="creative-drive-gallery curated">{finalVersions.slice((finalPage - 1) * ASSET_PAGE_SIZE, finalPage * ASSET_PAGE_SIZE).map((item) => { const asset = assetsById.get(item.asset_id); const displayName = asset ? driveDisplayName({ name: asset.name, originalFilename: null }, `Final v${item.version_number}`) : `Final v${item.version_number}`; return <div className="creative-drive-tile" key={item.id}><button type="button" className="creative-drive-tile-preview" disabled={!asset} onClick={() => asset && setSelected(files.find((file) => file.assetId === asset.id) ?? null)} aria-label={`Visualizar final ${displayName}`}><span className={`creative-drive-tile-art${asset?.mime_type.startsWith("video/") ? " video" : ""}`} aria-hidden>{asset ? <img src={`/api/admin/drive/thumbnail/${encodeURIComponent(asset.drive_file_id)}`} alt="" loading="lazy" /> : null}<span>{asset?.mime_type.startsWith("video/") ? "▶" : "▧"}</span></span><span className="creative-drive-tile-caption"><b title={displayName}>v{item.version_number} · {displayName}</b><small>{item.state === "current" ? "Atual" : item.state === "trashed" ? "Removida" : "Anterior"}</small></span></button><div className="creative-drive-tile-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void version(item.state === "trashed" ? "restore_final" : "trash_final", item.id)}>{item.state === "trashed" ? "Restaurar" : "Remover"}</button></div></div>; })}</div>{finalVersions.length ? <Pagination page={finalPage} total={Math.ceil(finalVersions.length / ASSET_PAGE_SIZE)} onPrevious={() => setFinalPage((page) => page - 1)} onNext={() => setFinalPage((page) => page + 1)} /> : <p className="admin-sub">Ainda não há finais promovidos.</p>}</section> : null}
      </> : null}
    </div><aside className="tm-side creative-drive-side">
      {targets.length ? <section className="tm-box docprev-cellbox" ref={targetRail}><p className="tm-box-label">Pastas dos Criativos</p><p className="admin-sub">Toque no nome para filtrar os brutos. Para vincular, arraste ou use Classificar após selecionar.</p><div className="creative-drive-targets">{targets.map((target) => <div key={target.id} className={`creative-drive-target${target.id === (activeTab === "raw" ? rawTargetId : activeTaskId) ? " on" : ""}`}
        onDragOver={(event) => { if (!draggedRawIds.current.length) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDrop={(event) => dropRaw(event, target.id)}>
        <button type="button" className="creative-drive-target-assign" disabled={Boolean(busy)} onClick={() => chooseRawTarget(target.id)} aria-label={`Ver brutos pendentes para ${target.title}`}><span aria-hidden>▣</span><span><b>{target.title}</b><small>{target.id === activeTaskId ? classifiedAssets.length : targetSummaries.find((summary) => summary.creative_task_id === target.id)?.raw_links.length ?? 0} bruto(s) vinculado(s)</small></span></button>
        {activeTab === "raw" && selectedRawIds.length ? <button type="button" className="creative-drive-target-link" disabled={Boolean(busy)} onClick={() => void assignRaw(target.id)} aria-label={`Classificar brutos em ${target.title}`}>Classificar</button> : null}
        <button type="button" className="creative-drive-target-open" disabled={Boolean(busy)} onClick={() => { setActiveTaskId(target.id); setActiveTab("classified"); }}>Abrir</button>
      </div>)}</div></section> : null}
      <section className="tm-box docprev-cellbox"><p className="tm-box-label">Detalhes</p><div className="docprev-cells"><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Arquivo</span><span className="tm-cell-static docprev-cell-wrap">{preview?.name ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Origem</span><span className="tm-cell-static">{preview?.source ?? "—"}</span></div></div><div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Formato</span><span className="tm-cell-static docprev-cell-wrap">{preview?.mimeType ?? "—"}</span></div></div>{preview?.size != null ? <div className="tm-cell"><div className="tm-cell-body"><span className="tm-cell-label">Tamanho</span><span className="tm-cell-static">{formatFileSize(preview.size)}</span></div></div> : null}</div></section>
    </aside></div>
    <footer className="kb-modal-actions"><span>{selectedRawIds.length ? `${selectedRawIds.length} bruto(s) para classificar` : selectedAssetIds.length ? `${selectedAssetIds.length} arquivo(s) para o próximo comentário` : ""}</span><span />{selectedRawIds.length ? <button type="button" className="admin-btn primary" onClick={() => targetRail.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Escolher pasta</button> : null}<button type="button" className="admin-btn ghost" onClick={onBack}>Voltar ao card</button></footer>
  </div></div>;
}
