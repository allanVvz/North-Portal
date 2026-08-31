"use client";

import { useState } from "react";
import DocumentDropZone from "./DocumentDropZone";
import TrilhaPreviewModal from "./TrilhaPreviewModal";
import { MAX_DOCUMENT_SIZE_BYTES, trilhaStoragePath, removeDocumentFile, uploadDocumentFile } from "@/lib/documentFiles";
import { youtubeIdFromUrl } from "@/lib/youtube";
import type { NorthTrilha } from "@/lib/validation";

// Trilhas North — a lista GLOBAL de material educacional do portal, a mesma para
// todo cliente. O admin adiciona uma apresentação HTML ou um vídeo do YouTube,
// reordena por arraste, e o `TrilhasPage` de cada cliente lê exatamente esta
// lista, na mesma ordem.
//
// Toda trilha (Manual do Cliente incluído) abre no mesmo modal de
// pré-visualização — `TrilhaPreviewModal` — com o conteúdo embutido. O Manual é
// a linha `kind='manual'`: fixa, editável só no metadado, nunca removível.

const KIND_ICON: Record<NorthTrilha["kind"], string> = {
  manual: "◆",
  slides_html: "▤",
  video_youtube: "▶",
};
const KIND_LABEL: Record<NorthTrilha["kind"], string> = {
  manual: "Manual do Cliente",
  slides_html: "Apresentação HTML",
  video_youtube: "Vídeo do YouTube",
};

type MetaDraft = { title: string; etapa: string; description: string };
type Creating =
  | { kind: "slides_html"; storage_path: string; file_url: string }
  | { kind: "video_youtube" }
  | null;

const EMPTY_META: MetaDraft = { title: "", etapa: "", description: "" };

export default function NorthTrilhasManager({ initial }: { initial: NorthTrilha[] }) {
  const [items, setItems] = useState<NorthTrilha[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const [preview, setPreview] = useState<NorthTrilha | null>(null);
  const [editing, setEditing] = useState<NorthTrilha | null>(null);
  const [creating, setCreating] = useState<Creating>(null);
  const [meta, setMeta] = useState<MetaDraft>(EMPTY_META);
  const [videoUrl, setVideoUrl] = useState("");

  const [dragId, setDragId] = useState<string | null>(null);

  const formOpen = editing !== null || creating !== null;

  function closeForm() {
    // Upload órfão de um HTML cuja criação foi cancelada.
    if (creating?.kind === "slides_html") void removeDocumentFile(creating.storage_path).catch(() => {});
    setCreating(null);
    setEditing(null);
    setMeta(EMPTY_META);
    setVideoUrl("");
    setError("");
    setProgress(null);
    setBusy(false);
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
      setCreating({ kind: "slides_html", storage_path: path, file_url: fileUrl });
      setMeta({ title: file.name.replace(/\.[^.]+$/, "") || file.name, etapa: "", description: "" });
    } catch {
      setError("Não foi possível enviar o arquivo.");
    }
    setProgress(null);
    setBusy(false);
  }

  function startVideo() {
    setEditing(null);
    setMeta(EMPTY_META);
    setVideoUrl("");
    setError("");
    setCreating({ kind: "video_youtube" });
  }

  function startEdit(t: NorthTrilha) {
    setCreating(null);
    setPreview(null);
    setError("");
    setMeta({ title: t.title, etapa: t.etapa, description: t.description });
    setEditing(t);
  }

  async function submit() {
    if (!meta.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (editing) {
        const res = await fetch(`/api/admin/north-trilhas/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: meta.title.trim(), etapa: meta.etapa.trim(), description: meta.description.trim() }),
        });
        if (!res.ok) throw new Error();
        const updated = (await res.json()) as NorthTrilha;
        setItems((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
        closeForm();
        return;
      }
      // Criação
      const body: Record<string, unknown> = {
        title: meta.title.trim(),
        etapa: meta.etapa.trim(),
        description: meta.description.trim(),
      };
      if (creating?.kind === "slides_html") {
        Object.assign(body, { kind: "slides_html", storage_path: creating.storage_path, file_url: creating.file_url });
      } else {
        const youtubeId = youtubeIdFromUrl(videoUrl);
        if (!youtubeId) {
          setError("Cole um link de vídeo do YouTube válido.");
          setBusy(false);
          return;
        }
        Object.assign(body, { kind: "video_youtube", youtube_id: youtubeId });
      }
      const res = await fetch("/api/admin/north-trilhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as NorthTrilha;
      setItems((rows) => [...rows, created].sort((a, b) => a.position - b.position));
      // não roda closeForm() aqui (removeria o arquivo recém-vinculado)
      setCreating(null);
      setEditing(null);
      setMeta(EMPTY_META);
      setVideoUrl("");
      setError("");
      setProgress(null);
      setBusy(false);
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

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Trilhas North</h2>
          <p className="admin-sub">
            A central educacional do portal — a mesma lista para todos os clientes. Adicione uma apresentação
            HTML ou um vídeo do YouTube; arraste os cards para reordenar a fila.
          </p>
        </div>
      </div>

      {!formOpen ? (
        <>
          <div className="trilha-add">
            <DocumentDropZone
              label="Arraste uma apresentação HTML ou clique para enviar"
              hint="HTML · máximo 50 MB"
              accept=".html,.htm,text/html"
              onFileSelected={(file) => void onHtmlPicked(file)}
            />
            <button type="button" className="admin-btn primary" onClick={startVideo} disabled={busy}>
              + Vídeo do YouTube
            </button>
          </div>
          {progress !== null ? (
            <div className="doc-upload-progress" aria-live="polite"><div><span style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
          ) : null}
          {error ? <p className="admin-error">{error}</p> : null}
        </>
      ) : null}

      <div className="trilha-list">
        {items.map((t, i) => (
          <div
            className={`trilha-card ${dragId === t.id ? "dragging" : ""}`}
            key={t.id}
            draggable={!formOpen}
            onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); void reorder(t.id); }}
          >
            <span className="trilha-card-ico" aria-hidden>{KIND_ICON[t.kind]}</span>
            <div className="trilha-card-body">
              <div className="trilha-card-titlerow">
                <strong>{t.title}</strong>
                {t.kind === "manual" ? <span className="set-badge publicada">Fixo</span> : null}
              </div>
              <span className="admin-sub">
                {KIND_LABEL[t.kind]}{t.etapa ? ` · ${t.etapa}` : ""} · {i + 1}ª na fila
              </span>
              {t.description ? <p className="trilha-card-desc">{t.description}</p> : null}
            </div>
            <div className="trilha-card-actions">
              <button className="admin-btn ghost" onClick={() => setPreview(t)} disabled={formOpen}>Visualizar</button>
              <button className="admin-btn ghost" onClick={() => startEdit(t)} disabled={busy || formOpen}>Editar</button>
              {t.kind !== "manual" ? (
                <button className="admin-btn ghost" onClick={() => void remove(t)} disabled={busy || formOpen}>Excluir</button>
              ) : null}
            </div>
          </div>
        ))}
        {items.length === 0 && !formOpen ? (
          <p className="admin-sub">Nenhuma trilha ainda. Adicione a primeira acima.</p>
        ) : null}
      </div>

      {preview ? (
        <TrilhaPreviewModal
          trilha={preview}
          positionInQueue={items.findIndex((r) => r.id === preview.id) + 1}
          onClose={() => setPreview(null)}
          onEdit={() => startEdit(preview)}
        />
      ) : null}

      {formOpen ? (
        <div className="kb-modal-backdrop" onClick={() => !busy && closeForm()}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kb-modal-head">
              <h2>
                {editing
                  ? `Editar ${editing.kind === "manual" ? "o Manual do Cliente" : "trilha"}`
                  : creating?.kind === "video_youtube" ? "Adicionar vídeo do YouTube" : "Adicionar apresentação HTML"}
              </h2>
              <button className="kb-modal-close" onClick={() => !busy && closeForm()} aria-label="Fechar">✕</button>
            </div>

            {editing?.kind === "manual" ? (
              <p className="admin-sub">
                Os 11 slides do Manual são fixos na plataforma — aqui você ajusta só como ele aparece na lista e
                no hero do portal.
              </p>
            ) : null}

            {creating?.kind === "video_youtube" ? (
              <label className="admin-field"><span>Link do vídeo do YouTube</span>
                <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
              </label>
            ) : null}

            <label className="admin-field"><span>Título</span>
              <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Ex.: Guia de Stories" autoFocus={creating?.kind !== "video_youtube"} />
            </label>
            <label className="admin-field"><span>Etapa</span>
              <input value={meta.etapa} onChange={(e) => setMeta({ ...meta, etapa: e.target.value })} placeholder="Ex.: Conteúdo" />
            </label>
            <label className="admin-field"><span>Descrição</span>
              <textarea rows={3} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            </label>

            {error ? <p className="admin-error" role="alert">{error}</p> : null}

            <div className="kb-modal-actions">
              <span />
              <div className="kb-modal-actions-right">
                <button className="admin-btn ghost" onClick={() => !busy && closeForm()} disabled={busy}>Cancelar</button>
                <button className="admin-btn primary" onClick={() => void submit()} disabled={busy || !meta.title.trim()}>
                  {busy ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
