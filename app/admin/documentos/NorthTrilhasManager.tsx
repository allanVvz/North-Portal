"use client";

import { useState } from "react";
import DocumentDropZone from "./DocumentDropZone";
import { MAX_DOCUMENT_SIZE_BYTES, trilhaStoragePath, removeDocumentFile, uploadDocumentFile } from "@/lib/documentFiles";
import { youtubeIdFromUrl } from "@/lib/youtube";
import type { NorthTrilha } from "@/lib/validation";

// Trilhas North — a lista GLOBAL de material educacional do portal. O admin
// adiciona uma apresentação HTML (subida no bucket `documents`, path
// `north-trilhas/...`) ou um vídeo do YouTube (só o id), reordena por arraste, e
// o `TrilhasPage` de todo cliente lê exatamente esta lista, na mesma ordem.
//
// A linha `kind='manual'` é o Manual do Cliente (deck hardcoded que move o % de
// onboarding): editável e arrastável, nunca removível.

const KIND_ICON: Record<NorthTrilha["kind"], string> = {
  manual: "◆",
  slides_html: "▤",
  video_youtube: "▶",
};
const KIND_LABEL: Record<NorthTrilha["kind"], string> = {
  manual: "Manual",
  slides_html: "Apresentação",
  video_youtube: "Vídeo",
};

type MetaDraft = { title: string; etapa: string; description: string };

export default function NorthTrilhasManager({ initial }: { initial: NorthTrilha[] }) {
  const [items, setItems] = useState<NorthTrilha[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  // Um de: editar linha existente | criar a partir de um HTML já subido | criar vídeo.
  const [editing, setEditing] = useState<string | null>(null);
  const [htmlUpload, setHtmlUpload] = useState<{ storage_path: string; file_url: string } | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [meta, setMeta] = useState<MetaDraft>({ title: "", etapa: "", description: "" });
  const [videoUrl, setVideoUrl] = useState("");

  // drag-and-drop (padrão de OperacaoWorkspace.reorderBefore)
  const [dragId, setDragId] = useState<string | null>(null);

  function resetForm() {
    setEditing(null);
    setHtmlUpload(null);
    setVideoOpen(false);
    setMeta({ title: "", etapa: "", description: "" });
    setVideoUrl("");
    setError("");
    setProgress(null);
  }

  async function onHtmlPicked(file: File) {
    setError("");
    if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
      setError("Envie um arquivo HTML.");
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setError("O arquivo excede o limite de 50 MB.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const path = trilhaStoragePath(file.name);
      const fileUrl = await uploadDocumentFile(file, path, setProgress);
      setHtmlUpload({ storage_path: path, file_url: fileUrl });
      setMeta({ title: file.name.replace(/\.[^.]+$/, "") || file.name, etapa: "", description: "" });
    } catch {
      setError("Não foi possível enviar o arquivo.");
    }
    setProgress(null);
    setBusy(false);
  }

  async function createHtml() {
    if (!htmlUpload || !meta.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/north-trilhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "slides_html",
          title: meta.title.trim(),
          etapa: meta.etapa.trim(),
          description: meta.description.trim(),
          storage_path: htmlUpload.storage_path,
          file_url: htmlUpload.file_url,
        }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as NorthTrilha;
      setItems((rows) => [...rows, created].sort((a, b) => a.position - b.position));
      resetForm();
    } catch {
      setError("Não foi possível salvar a trilha.");
      setBusy(false);
    }
  }

  async function createVideo() {
    if (!meta.title.trim()) return;
    const youtubeId = youtubeIdFromUrl(videoUrl);
    if (!youtubeId) {
      setError("Cole um link de vídeo do YouTube válido.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/north-trilhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video_youtube",
          title: meta.title.trim(),
          etapa: meta.etapa.trim(),
          description: meta.description.trim(),
          youtube_id: youtubeId,
        }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as NorthTrilha;
      setItems((rows) => [...rows, created].sort((a, b) => a.position - b.position));
      resetForm();
    } catch {
      setError("Não foi possível salvar a trilha.");
      setBusy(false);
    }
  }

  function startEdit(t: NorthTrilha) {
    setHtmlUpload(null);
    setVideoOpen(false);
    setEditing(t.id);
    setMeta({ title: t.title, etapa: t.etapa, description: t.description });
    setError("");
  }

  async function saveEdit() {
    if (!editing || !meta.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/north-trilhas/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: meta.title.trim(), etapa: meta.etapa.trim(), description: meta.description.trim() }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as NorthTrilha;
      setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      resetForm();
    } catch {
      setError("Não foi possível salvar.");
      setBusy(false);
    }
  }

  async function remove(t: NorthTrilha) {
    if (t.kind === "manual") return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/north-trilhas/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setItems((rows) => rows.filter((r) => r.id !== t.id));
      if (t.storage_path) await removeDocumentFile(t.storage_path).catch(() => {});
    } catch {
      setError("Não foi possível remover.");
    }
    setBusy(false);
  }

  async function reorder(beforeId: string) {
    const id = dragId;
    setDragId(null);
    if (!id || id === beforeId) return;
    const dragged = items.find((r) => r.id === id);
    if (!dragged) return;
    const others = items.filter((r) => r.id !== id);
    const at = others.findIndex((r) => r.id === beforeId);
    const reordered = at === -1 ? [...others, dragged] : [...others.slice(0, at), dragged, ...others.slice(at)];
    const renumbered = reordered.map((r, i) => ({ ...r, position: i * 10 }));
    const before = items;
    setError("");
    setItems(renumbered);
    const changed = renumbered.filter((r) => (before.find((b) => b.id === r.id)?.position ?? -1) !== r.position);
    try {
      const results = await Promise.all(
        changed.map((r) =>
          fetch(`/api/admin/north-trilhas/${r.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ position: r.position }),
          }),
        ),
      );
      if (results.some((res) => !res.ok)) {
        setItems(before);
        setError("Não foi possível reordenar.");
      }
    } catch {
      setItems(before);
      setError("Não foi possível reordenar — verifique sua conexão.");
    }
  }

  const formOpen = editing !== null || htmlUpload !== null || videoOpen;

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Trilhas North</h2>
          <p className="admin-sub">
            A central educacional do portal — a mesma lista para todos os clientes. Adicione uma apresentação
            HTML ou um vídeo do YouTube; arraste para reordenar a fila.
          </p>
        </div>
      </div>

      {!formOpen ? (
        <div className="trilha-add">
          <DocumentDropZone
            label="Arraste uma apresentação HTML ou clique para enviar"
            hint="HTML · máximo 50 MB"
            accept=".html,.htm,text/html"
            onFileSelected={(file) => void onHtmlPicked(file)}
          />
          <button type="button" className="admin-btn primary" onClick={() => { resetForm(); setVideoOpen(true); }} disabled={busy}>
            + Vídeo do YouTube
          </button>
        </div>
      ) : null}

      {progress !== null ? (
        <div className="doc-upload-progress" aria-live="polite"><div><span style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
      ) : null}
      {error && !formOpen ? <p className="admin-error">{error}</p> : null}

      {/* Formulário: dá nome a um HTML recém-subido, cria um vídeo, ou edita uma linha. */}
      {formOpen ? (
        <div className="set-legal-editor">
          {videoOpen ? (
            <label className="admin-field"><span>Link do vídeo do YouTube</span>
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
            </label>
          ) : null}
          <label className="admin-field"><span>Título</span>
            <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Ex.: Guia de Stories" autoFocus={!videoOpen} />
          </label>
          <label className="admin-field"><span>Etapa</span>
            <input value={meta.etapa} onChange={(e) => setMeta({ ...meta, etapa: e.target.value })} placeholder="Ex.: Conteúdo" />
          </label>
          <label className="admin-field"><span>Descrição</span>
            <textarea rows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </label>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <div className="set-actions">
            <span />
            <div className="kb-modal-actions-right">
              <button
                className="admin-btn ghost"
                onClick={() => {
                  // desfaz o upload órfão se cancelar a criação de um HTML
                  if (htmlUpload) void removeDocumentFile(htmlUpload.storage_path).catch(() => {});
                  resetForm();
                }}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                className="admin-btn primary"
                onClick={() => { void (editing ? saveEdit() : videoOpen ? createVideo() : createHtml()); }}
                disabled={busy || !meta.title.trim()}
              >
                {busy ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="set-legal trilha-list">
        {items.map((t) => (
          <div
            className={`set-legal-row trilha-row ${dragId === t.id ? "dragging" : ""}`}
            key={t.id}
            draggable={!formOpen}
            onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); void reorder(t.id); }}
          >
            {editing === t.id ? null : (
              <>
                <span className="set-legal-ico" aria-hidden>{KIND_ICON[t.kind]}</span>
                <div className="set-legal-meta">
                  <strong>{t.title}</strong>
                  <span className="admin-sub">
                    {KIND_LABEL[t.kind]}{t.etapa ? ` · ${t.etapa}` : ""}
                  </span>
                </div>
                {t.kind === "manual" ? <span className="set-badge publicada">Fixo</span> : null}
                <button className="admin-btn ghost" onClick={() => startEdit(t)} disabled={busy || formOpen}>Editar</button>
                {t.kind !== "manual" ? (
                  <button className="admin-btn ghost" onClick={() => void remove(t)} disabled={busy || formOpen}>Excluir</button>
                ) : null}
              </>
            )}
          </div>
        ))}
        {items.length === 0 && !formOpen ? (
          <p className="admin-sub">Nenhuma trilha ainda. Adicione a primeira acima.</p>
        ) : null}
      </div>
    </div>
  );
}
