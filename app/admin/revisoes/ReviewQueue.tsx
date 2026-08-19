"use client";

import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import { commentsOf, formatCommentTime } from "@/lib/comments";
import type { ApprovalRecord } from "@/lib/supabase";
import { kindLabel, kindTone } from "@/lib/taskCatalog";
import { filterByClient, reviewQueueRows } from "../approvalGroups";

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

export default function ReviewQueue({
  initial,
  clients,
}: {
  initial: ApprovalRecord[];
  clients: ClientLite[];
}) {
  const [items, setItems] = useState<ApprovalRecord[]>(initial);
  const [clientFilter, setClientFilter] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [toast, setToast] = useState<string>("");
  const [openTask, setOpenTask] = useState<ApprovalRecord | null>(null);

  // Defesa extra: mesmo vindo já filtrado do servidor, só renderiza o que
  // realmente está na coluna "Revisão" agora (a fonte de verdade é o Kanban).
  const rows = useMemo(() => filterByClient(reviewQueueRows(items), clientFilter), [items, clientFilter]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    const prev = items;
    setItems((current) => current.map((r) => (r.id === id ? { ...r, ...body } : r)));
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev);
      flash("Não foi possível atualizar. Tente novamente.");
    }
    setBusy("");
  }

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  }

  return (
    <div className="ap">
      <div className="ap-filters">
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="ap-clientfilter">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="admin-empty">Nada em revisão.</p>
      ) : (
        <div className="ap-list">
          {rows.map((t) => {
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
                    Em revisão
                    {t.reviewerName ? ` · Revisor: ${t.reviewerName}` : " · sem revisor atribuído"}
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
                  <button className="admin-btn ghost" disabled={busy === t.id} onClick={() => patch(t.id, { status: "em_producao" })}>
                    Ajustes
                  </button>
                  <button
                    className="admin-btn primary"
                    disabled={busy === t.id}
                    onClick={() => patch(t.id, { status: "aprovacao" })}
                  >
                    Enviar para aprovação
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

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
