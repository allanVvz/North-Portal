"use client";

import { useEffect, useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import { commentsOf, formatCommentTime } from "@/lib/comments";
import type { ApprovalRecord } from "@/lib/supabase";
import { kindTone } from "@/lib/taskCatalog";
import { taskClassificationLabel } from "@/lib/taskClassification";
import { filterByClient, reviewQueueRows } from "../approvalGroups";
import TaskReviewActions from "../TaskReviewActions";
import { useCurrentAdminUser } from "../CurrentUserContext";

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
  const [openTask, setOpenTask] = useState<ApprovalRecord | null>(null);
  const [conversationByTask, setConversationByTask] = useState<Record<string, Array<{ kind: string; text?: string; author?: string | null; at: string }>>>({});
  const { userId } = useCurrentAdminUser();

  // Defesa extra: mesmo vindo já filtrado do servidor, só renderiza o que
  // realmente está na coluna "Revisão" agora (a fonte de verdade é o Kanban).
  const rows = useMemo(() => filterByClient(reviewQueueRows(items), clientFilter), [items, clientFilter]);
  useEffect(() => {
    let cancelled = false;
    if (!rows.length) return;
    void fetch("/api/admin/tasks/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: rows.map((row) => row.id) }), cache: "no-store",
    }).then(async (response) => response.ok ? response.json() as Promise<{ itemsByTaskId: Record<string, Array<{ kind: string; text?: string; author?: string | null; at: string }>> }> : null).then((body) => {
      if (cancelled) return;
      if (!body) return;
      setConversationByTask((current) => ({ ...current, ...Object.fromEntries(Object.entries(body.itemsByTaskId).map(([taskId, items]) => [taskId, items.filter((entry) => entry.kind === "comment" || entry.kind === "event")])) }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [rows]);

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
            const comments = conversationByTask[t.id] ?? commentsOf(t.payload).map((item) => ({ kind: "comment", ...item }));
            const lastComment = comments[comments.length - 1];
            const payload = (t.payload ?? {}) as Record<string, unknown>;
            const humanReviewers = Array.isArray(payload.reviewer_ids) ? payload.reviewer_ids.filter((id): id is string => typeof id === "string") : t.reviewer_id ? [t.reviewer_id] : [];
            const northAiReviewer = Boolean((t as typeof t & { north_ai_reviewer?: boolean }).north_ai_reviewer);
            const deliveryLinks = t.parents.filter((link) => link.relation_kind === "workflow_step");
            return (
              <article className="ap-row" key={t.id}>
                <span className={`ap-thumb tone-${tone(t)}`} aria-hidden />
                <div className="ap-body">
                  <div className="ap-metaline">
                    <span className={`ap-type tone-${tone(t)}`}>{taskClassificationLabel(t.kind, t.subtype)}</span>
                    <span className="ap-client">{t.clientName}</span>
                    {comments.length > 0 ? <span className="ap-comment-badge" title="Comentários e atividade no card">💬 {comments.length}</span> : null}
                  </div>
                  <p className="ap-title">{t.title}</p>
                  <p className="ap-sub">
                    Em revisão
                    {humanReviewers.length ? ` · Revisor: ${t.reviewerName ?? "designado"}` : northAiReviewer ? " · North AI revisora atribuída" : " · atribua um revisor para iniciar a revisão"}
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
                  {humanReviewers.length && deliveryLinks.length <= 1 ? <TaskReviewActions taskId={t.id} status={t.status} reviewerIds={humanReviewers} currentUserId={userId} deliveryId={deliveryLinks[0]?.id} onDecided={(updated, effectiveStatus) => setItems((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated, status: effectiveStatus ?? updated.status } : row))} /> : deliveryLinks.length > 1 ? <p className="ap-review-context">Abra a Entrega para escolher onde aplicar esta decisão.</p> : null}
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

    </div>
  );
}
