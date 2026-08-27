"use client";

import { useMemo, useState } from "react";
import DocumentPreviewModal from "./DocumentPreviewModal";
import { initialsOf as initials } from "../../avatar/initials";
import DocumentDropZone from "./DocumentDropZone";
import DocumentsFilterBar, { documentMatchesFilters, type DocActiveFilter } from "./DocumentsFilterBar";
import type { AdminDocument } from "@/lib/supabase";
import type { DocumentStatus, DocumentType } from "@/lib/validation";
import { MAX_DOCUMENT_SIZE_BYTES, documentStoragePath, fileTypeLabel, formatFileSize, isHtmlDocument, removeDocumentFile, uploadDocumentFile } from "@/lib/documentFiles";

type ClientLite = { slug: string; name: string };

const TYPE_LABEL: Record<DocumentType, string> = {
  contrato: "Contrato", proposta: "Proposta", relatorio: "Relatório", material: "Material",
};
const STATUS_LABEL: Record<DocumentStatus, string> = {
  enviada: "Enviada", assinado: "Assinado", aguardando_assinatura: "Aguardando assinatura",
  publicado: "Publicado", compartilhado: "Compartilhado",
};
const STATUS_TONE: Record<DocumentStatus, string> = {
  enviada: "blue", assinado: "green", aguardando_assinatura: "red", publicado: "green", compartilhado: "purple",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[3]} ${MES[Number(m[2]) - 1]} ${m[1]}`;
}

type Draft = {
  id?: string;
  slug: string;
  name: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  file_url: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number | null;
  doc_date: string;
};

export default function DocumentsTable({
  initial,
  clients,
  variant = "documentos",
}: {
  initial: AdminDocument[];
  clients: ClientLite[];
  variant?: "documentos" | "trilhas";
}) {
  const [docs, setDocs] = useState<AdminDocument[]>(initial);
  const [filters, setFilters] = useState<DocActiveFilter[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewDoc, setPreviewDoc] = useState<AdminDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replacingFile, setReplacingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [nameTouched, setNameTouched] = useState(false);

  const scoped = useMemo(
    () => docs.filter((d) => isHtmlDocument(d) === (variant === "trilhas")),
    [docs, variant],
  );
  const rows = useMemo(
    () => (variant === "trilhas" ? scoped : scoped.filter((d) => documentMatchesFilters(d, filters, TYPE_LABEL, STATUS_LABEL))),
    [scoped, filters, variant],
  );

  function newDoc(fromFile?: File) {
    setSelectedFile(fromFile ?? null);
    setReplacingFile(true);
    setUploadProgress(null);
    setNameTouched(Boolean(fromFile));
    setError("");
    setDraft({
      slug: clients[0]?.slug ?? "",
      name: fromFile ? fromFile.name.replace(/\.[^.]+$/, "") || fromFile.name : "",
      doc_type: "contrato",
      status: "enviada",
      file_url: "",
      storage_path: "",
      original_file_name: "",
      mime_type: "",
      size_bytes: null,
      doc_date: "",
    });
  }
  function editDoc(d: AdminDocument) {
    setSelectedFile(null); setReplacingFile(false); setUploadProgress(null); setNameTouched(true); setError("");
    setDraft({ id: d.id, slug: d.clientSlug, name: d.name, doc_type: d.doc_type, status: d.status, file_url: d.file_url ?? "", storage_path: d.storage_path ?? "", original_file_name: d.original_file_name ?? "", mime_type: d.mime_type ?? "", size_bytes: d.size_bytes, doc_date: d.doc_date ?? "" });
  }

  async function refresh() {
    const res = await fetch("/api/admin/documents");
    if (res.ok) setDocs((await res.json()).documents ?? []);
  }

  async function save() {
    if (!draft || !draft.name.trim() || !draft.slug) return;
    if (!draft.id && !selectedFile) { setError("Selecione um arquivo para criar o documento."); return; }
    if (selectedFile && selectedFile.size > MAX_DOCUMENT_SIZE_BYTES) { setError("O arquivo excede o limite de 50 MB."); return; }
    setBusy(true);
    setError("");
    let uploadedPath: string | null = null;
    let recordSaved = false;
    try {
      let fileFields = {
        file_url: draft.file_url.trim() || null,
        storage_path: draft.storage_path.trim() || null,
        original_file_name: draft.original_file_name.trim() || null,
        mime_type: draft.mime_type.trim() || null,
        size_bytes: draft.size_bytes,
      };
      if (selectedFile) {
        uploadedPath = documentStoragePath(draft.slug, selectedFile.name);
        setUploadProgress(0);
        const publicUrl = await uploadDocumentFile(selectedFile, uploadedPath, setUploadProgress);
        fileFields = { file_url: publicUrl, storage_path: uploadedPath, original_file_name: selectedFile.name, mime_type: selectedFile.type || "application/octet-stream", size_bytes: selectedFile.size };
      }
      const body = { name: draft.name.trim(), doc_type: draft.doc_type, status: draft.status, ...fileFields, doc_date: draft.doc_date.trim() || null };
      const res = draft.id
        ? await fetch(`/api/admin/documents/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, slug: draft.slug }) });
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Não foi possível salvar o documento.");
      }
      recordSaved = true;
      if (selectedFile && draft.storage_path && draft.storage_path !== uploadedPath) {
        try { await removeDocumentFile(draft.storage_path); } catch { /* the new record is already valid */ }
      }
      setDraft(null);
      await refresh();
    } catch (caught) {
      if (uploadedPath && !recordSaved) {
        try { await removeDocumentFile(uploadedPath); } catch { /* preserve the primary error */ }
      }
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o documento.");
    }
    setUploadProgress(null);
    setBusy(false);
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/documents/${draft.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDraft(null);
      await refresh();
    } catch {
      setError("Não foi possível excluir o documento e seu arquivo.");
    }
    setBusy(false);
  }

  const isTrilhas = variant === "trilhas";

  return (
    <div className="doc">
      <DocumentDropZone
        label={isTrilhas ? "Arraste uma apresentação HTML ou clique para enviar" : "Arraste um documento ou clique para enviar"}
        hint={isTrilhas ? "HTML · máximo 50 MB" : "PDF e outros formatos · máximo 50 MB"}
        accept={isTrilhas ? ".html,.htm,text/html" : undefined}
        onFileSelected={(file) => newDoc(file)}
      />

      {!isTrilhas ? (
        <div className="doc-toolbar">
          <DocumentsFilterBar docs={scoped} filters={filters} onFiltersChange={setFilters} typeLabel={TYPE_LABEL} statusLabel={STATUS_LABEL} />
        </div>
      ) : null}

      {error && !draft ? <p className="admin-error">{error}</p> : null}

      {isTrilhas ? (
        <div className="doc-grid">
          {rows.map((d) => (
            <div
              className="doc-grid-card"
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => setPreviewDoc(d)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPreviewDoc(d); } }}
            >
              <span className="doc-ico">{fileTypeLabel(d)}</span>
              <strong>{d.name}</strong>
              <span className="doc-client"><span className="doc-avatar">{initials(d.clientName)}</span>{d.clientName}</span>
              <span className="doc-grid-date">{fmtDate(d.doc_date)}</span>
              <button
                type="button"
                className="doc-open-btn doc-grid-edit"
                onClick={(e) => { e.stopPropagation(); editDoc(d); }}
              >
                Editar
              </button>
            </div>
          ))}
          {rows.length === 0 ? <p className="admin-empty">Nenhuma trilha enviada ainda.</p> : null}
        </div>
      ) : (
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr><th>Documento</th><th>Cliente</th><th>Tipo</th><th>Data</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} onClick={() => setPreviewDoc(d)}>
                  <td>
                    <span className="doc-name"><span className="doc-ico">{fileTypeLabel(d)}</span>{d.name}</span>
                  </td>
                  <td>
                    <span className="doc-client"><span className="doc-avatar">{initials(d.clientName)}</span>{d.clientName}</span>
                  </td>
                  <td>{TYPE_LABEL[d.doc_type]}</td>
                  <td className="doc-date">{fmtDate(d.doc_date)}</td>
                  <td><span className={`doc-status tone-${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span></td>
                  <td className="doc-open">
                    <button
                      type="button"
                      className="doc-open-btn"
                      onClick={(e) => { e.stopPropagation(); editDoc(d); }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={6} className="admin-empty" style={{ padding: 28 }}>Nenhum documento nesta visão.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <div className="kb-modal-backdrop" onClick={() => !busy && setDraft(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kb-modal-head">
              <h2>{draft.id ? "Editar documento" : isTrilhas ? "Enviar trilha" : "Enviar documento"}</h2>
              <button className="kb-modal-close" onClick={() => setDraft(null)} aria-label="Fechar">✕</button>
            </div>
            <label className="admin-field"><span>Nome</span>
              <input value={draft.name} onChange={(e) => { setNameTouched(true); setDraft({ ...draft, name: e.target.value }); }} autoFocus placeholder="Contrato de prestação" />
            </label>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Cliente</span>
                <select value={draft.slug} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, slug: e.target.value })}>
                  {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </label>
              <label className="admin-field"><span>Tipo</span>
                <select value={draft.doc_type} onChange={(e) => setDraft({ ...draft, doc_type: e.target.value as DocumentType })}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Status</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DocumentStatus })}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="admin-field"><span>Data</span>
                <input value={draft.doc_date} onChange={(e) => setDraft({ ...draft, doc_date: e.target.value })} placeholder="2026-06-01" />
              </label>
            </div>
            {draft.id && !replacingFile ? (
              <div className="doc-upload-current">
                <div><strong>{draft.original_file_name || "Documento por link"}</strong><span>{draft.mime_type || "Tipo não informado"}{draft.size_bytes !== null ? ` · ${formatFileSize(draft.size_bytes)}` : ""}</span></div>
                <button type="button" className="admin-btn ghost" onClick={() => setReplacingFile(true)} disabled={busy}>Substituir arquivo</button>
              </div>
            ) : (
              <label className="admin-field doc-upload-field"><span>{draft.id ? "Novo arquivo" : "Arquivo"} · máximo 50 MB</span>
                <input type="file" accept={isTrilhas ? ".html,.htm,text/html" : undefined} onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  setError(file && file.size > MAX_DOCUMENT_SIZE_BYTES ? "O arquivo excede o limite de 50 MB." : "");
                  if (file && !nameTouched) setDraft({ ...draft, name: file.name.replace(/\.[^.]+$/, "") || file.name });
                }} disabled={busy} />
                {selectedFile ? <span className="doc-upload-meta">{selectedFile.name} · {formatFileSize(selectedFile.size)} · {selectedFile.type || "application/octet-stream"}</span> : null}
              </label>
            )}
            {uploadProgress !== null ? <div className="doc-upload-progress" aria-live="polite"><div><span style={{ width: `${uploadProgress}%` }} /></div><b>{uploadProgress}%</b></div> : null}
            {error ? <p className="admin-error" role="alert">{error}</p> : null}
            <div className="kb-modal-actions">
              {draft.id ? <button className="admin-btn ghost danger" onClick={remove} disabled={busy}>Excluir</button> : <span />}
              <div className="kb-modal-actions-right">
                <button className="admin-btn ghost" onClick={() => setDraft(null)} disabled={busy}>Cancelar</button>
                <button className="admin-btn primary" onClick={save} disabled={busy || !draft.name.trim() || (!draft.id && !selectedFile) || Boolean(selectedFile && selectedFile.size > MAX_DOCUMENT_SIZE_BYTES)}>{busy ? (uploadProgress !== null && uploadProgress < 100 ? "Enviando…" : "Salvando…") : "Salvar"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewDoc ? (
        <DocumentPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onChanged={(updated) => {
            setPreviewDoc(updated);
            setDocs((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
          }}
        />
      ) : null}
    </div>
  );
}
