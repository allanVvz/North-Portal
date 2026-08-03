"use client";

import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import { commentsOf, formatCommentTime } from "@/lib/comments";
import type { ApprovalRecord } from "@/lib/supabase";
import { kindLabel, kindTone } from "@/lib/taskCatalog";
import { filterByClient, groupApprovalQueue } from "../approvalGroups";

type ClientLite = { slug: string; name: string };

function tone(t: ApprovalRecord): string {
  const p = (t.payload ?? {}) as Record<string, unknown>;
  if (typeof p.barTone === "string") return p.barTone;
  if (typeof p.statusTone === "string") return p.statusTone;
  return kindTone(t.kind);
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "agora";
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return "há minutos";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

export default function ApprovalsQueue({
  initial,
  clients,
  canApprove,
}: {
  initial: ApprovalRecord[];
  clients: ClientLite[];
  canApprove: boolean;
}) {
  const [items, setItems] = useState<ApprovalRecord[]>(initial);
  const [clientFilter, setClientFilter] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const [commentFor, setCommentFor] = useState<ApprovalRecord | null>(null);
  const [openTask, setOpenTask] = useState<ApprovalRecord | null>(null);

  const scoped = useMemo(() => filterByClient(items, clientFilter), [items, clientFilter]);
  const groups = useMemo(() => groupApprovalQueue(scoped), [scoped]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  }

  async function patch(id: string, body: Record<string, unknown>, successMsg?: string) {
    setBusy(id);
    const prev = items;
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      if (successMsg) flash(successMsg);
    } catch {
      setItems(prev);
      flash("Não foi possível atualizar. Tente novamente.");
    }
    setBusy("");
  }

  function approve(t: ApprovalRecord) {
    void patch(t.id, { status: "aprovado" }, "Card aprovado.");
  }

  function reopen(t: ApprovalRecord) {
    void patch(t.id, { status: "aprovacao" }, "Card reaberto para aprovação.");
  }

  function sendComment(t: ApprovalRecord, text: string) {
    const comments = [...commentsOf(t.payload), { author: "Admin North", text, at: new Date().toISOString() }];
    void patch(t.id, { payload: { ...t.payload, comments } }, "Comentário enviado.");
    setCommentFor(null);
  }

  return (
    <div className="ap">
      <div className="ap-filters">
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="ap-clientfilter">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      {groups.pending.length === 0 ? (
        <p className="admin-empty">Nada aguardando aprovação.</p>
      ) : (
        <div className="ap-list">
          {groups.pending.map((t) => {
            const comments = commentsOf(t.payload);
            const lastComment = comments[comments.length - 1];
            return (
              <article className="ap-row" key={t.id}>
                <span className={`ap-thumb tone-${tone(t)}`} aria-hidden />
                <div className="ap-body">
                  <div className="ap-metaline">
                    <span className={`ap-type tone-${tone(t)}`}>{kindLabel(t.kind)}</span>
                    <span className="ap-client">{t.clientName}</span>
                    {comments.length > 0 ? <span className="ap-comment-badge" title="Comentários no card">💬 {comments.length}</span> : null}
                  </div>
                  <p className="ap-title">{t.title}</p>
                  <p className="ap-sub">
                    Aguardando aprovação
                    {t.approverName ? ` · Aprovador: ${t.approverName}` : " · sem aprovador atribuído"}
                    {t.assignee ? ` · ${t.assignee}` : ""}
                    {relTime(t.updated_at) ? ` · ${relTime(t.updated_at)}` : ""}
                  </p>
                  {lastComment ? (
                    <p className="ap-comment-preview">"{lastComment.text}" <span>— {lastComment.author} · {formatCommentTime(lastComment.at)}</span></p>
                  ) : null}
                </div>
                <div className="ap-actions">
                  <button className="admin-btn ghost" onClick={() => setOpenTask(t)}>
                    Abrir card
                  </button>
                  <button className="admin-btn ghost" disabled={busy === t.id} onClick={() => setCommentFor(t)}>
                    Ajustes
                  </button>
                  <button
                    className="admin-btn primary"
                    disabled={busy === t.id || !canApprove}
                    title={canApprove ? undefined : "Apenas gerentes podem aprovar"}
                    onClick={() => approve(t)}
                  >
                    Aprovar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="ap-history">
        <p className="admin-kicker">Concluídas</p>
        {groups.resolved.length === 0 ? (
          <p className="admin-empty">Nenhum card concluído ainda.</p>
        ) : (
          <div className="ap-list">
            {groups.resolved.map((t) => (
              <article className="ap-row" key={t.id}>
                <span className={`ap-thumb tone-${tone(t)}`} aria-hidden />
                <div className="ap-body">
                  <div className="ap-metaline">
                    <span className={`ap-type tone-${tone(t)}`}>{kindLabel(t.kind)}</span>
                    <span className="ap-client">{t.clientName}</span>
                  </div>
                  <p className="ap-title">{t.title}</p>
                  <p className="ap-sub">Concluído{relTime(t.updated_at) ? ` · ${relTime(t.updated_at)}` : ""}</p>
                </div>
                <div className="ap-actions">
                  <button className="admin-btn ghost" onClick={() => setOpenTask(t)}>
                    Abrir card
                  </button>
                  <button
                    className="admin-btn ghost"
                    disabled={busy === t.id || !canApprove}
                    title={canApprove ? undefined : "Apenas gerentes podem reabrir"}
                    onClick={() => reopen(t)}
                  >
                    Reabrir
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {commentFor ? (
        <AdminCommentModal
          task={commentFor}
          busy={busy === commentFor.id}
          onClose={() => setCommentFor(null)}
          onSubmit={(text) => sendComment(commentFor, text)}
        />
      ) : null}

      {openTask ? (
        <CardModalLauncher
          task={openTask}
          clientName={openTask.clientName}
          clientSlug={openTask.clientSlug}
          onClose={() => setOpenTask(null)}
          onSaved={(updated) => {
            setItems((rows) => rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
            setOpenTask(null);
          }}
          onDeleted={(id) => {
            setItems((rows) => rows.filter((r) => r.id !== id));
            setOpenTask(null);
          }}
        />
      ) : null}

      {toast ? <div className="ap-toast" role="status">{toast}</div> : null}
    </div>
  );
}

function AdminCommentModal(props: { task: ApprovalRecord; busy: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const { task, busy, onClose, onSubmit } = props;
  const [text, setText] = useState("");
  return (
    <div className="kb-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="tm tone-neutral ap-comment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head tm-head-plain">
          <div>
            <h2>Solicitar ajustes</h2>
            <p className="admin-sub">{task.title} · {task.clientName}</p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="tm-box">
          <p className="tm-box-label">Comentário para o card</p>
          <textarea
            className="tm-desc-input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="O que precisa ser ajustado antes de aprovar…"
            autoFocus
          />
        </div>
        <div className="kb-modal-actions">
          <span />
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="admin-btn primary" onClick={() => text.trim() && onSubmit(text.trim())} disabled={busy || !text.trim()}>
              {busy ? "Enviando…" : "Enviar comentário"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
