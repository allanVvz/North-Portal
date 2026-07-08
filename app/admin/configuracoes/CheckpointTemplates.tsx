"use client";

import { useState } from "react";
import type { CheckpointTemplate } from "@/lib/supabase";

type Draft = { title: string; description: string; order_index: number; active: boolean };

function toDraft(t: CheckpointTemplate): Draft {
  return { title: t.title, description: t.description ?? "", order_index: t.order_index, active: t.active };
}

export default function CheckpointTemplates({ initial }: { initial: CheckpointTemplate[] }) {
  const [items, setItems] = useState<CheckpointTemplate[]>(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(t: CheckpointTemplate) {
    setEditing(t.id);
    setDraft(toDraft(t));
  }

  function startNew() {
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order_index)) + 10 : 10;
    setEditing("new");
    setDraft({ title: "", description: "", order_index: nextOrder, active: true });
  }

  async function save() {
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    try {
      if (editing === "new") {
        const res = await fetch("/api/admin/checkpoint-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (res.ok) {
          const created = (await res.json()) as CheckpointTemplate;
          setItems((rows) => [...rows, created].sort((a, b) => a.order_index - b.order_index));
        }
      } else if (editing) {
        const res = await fetch(`/api/admin/checkpoint-templates/${editing}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (res.ok) {
          const updated = (await res.json()) as CheckpointTemplate;
          setItems((rows) => rows.map((r) => (r.id === editing ? updated : r)).sort((a, b) => a.order_index - b.order_index));
        }
      }
      setEditing(null);
      setDraft(null);
    } catch { /* keep editor open */ }
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/checkpoint-templates/${id}`, { method: "DELETE" });
      if (res.ok) setItems((rows) => rows.filter((r) => r.id !== id));
    } catch { /* no-op */ }
    setBusy(false);
  }

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Checkpoints comerciais</h2>
          <p className="admin-sub">
            Molde padrão dos checkpoints comerciais. Todo cliente novo ganha automaticamente um card por checkpoint ativo aqui —
            o progresso de onboarding do cliente é a média desses cards.
          </p>
        </div>
        {editing === null ? (
          <button className="admin-btn primary" onClick={startNew} disabled={busy}>+ Novo checkpoint</button>
        ) : null}
      </div>

      <div className="set-legal">
        {items.map((t) => (
          <div className="set-legal-row" key={t.id}>
            {editing === t.id && draft ? (
              <CheckpointEditor draft={draft} setDraft={setDraft} busy={busy} onCancel={() => { setEditing(null); setDraft(null); }} onSave={save} />
            ) : (
              <>
                <span className="set-legal-ico">◈</span>
                <div className="set-legal-meta">
                  <strong>{t.title}</strong>
                  {t.description ? <span className="admin-sub">{t.description}</span> : null}
                </div>
                <span className={`set-badge ${t.active ? "publicada" : "rascunho"}`}>{t.active ? "Ativo" : "Inativo"}</span>
                <button className="admin-btn ghost" onClick={() => edit(t)} disabled={busy}>Editar</button>
                <button className="admin-btn ghost" onClick={() => remove(t.id)} disabled={busy}>Excluir</button>
              </>
            )}
          </div>
        ))}
        {items.length === 0 && editing !== "new" ? <p className="admin-sub">Nenhum checkpoint configurado ainda.</p> : null}
        {editing === "new" && draft ? (
          <div className="set-legal-row">
            <CheckpointEditor draft={draft} setDraft={setDraft} busy={busy} onCancel={() => { setEditing(null); setDraft(null); }} onSave={save} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckpointEditor({
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="set-legal-editor">
      <label className="admin-field"><span>Título</span>
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ex.: Assinatura de contrato" />
      </label>
      <label className="admin-field"><span>Descrição</span>
        <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <div className="admin-field-row">
        <label className="admin-field"><span>Ordem</span>
          <input type="number" value={draft.order_index} onChange={(e) => setDraft({ ...draft, order_index: Number(e.target.value) || 0 })} />
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span className="sw" /><span>Ativo</span>
        </label>
      </div>
      <div className="set-actions">
        <span />
        <div className="kb-modal-actions-right">
          <button className="admin-btn ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="admin-btn primary" onClick={onSave} disabled={busy || !draft.title.trim()}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
