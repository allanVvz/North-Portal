"use client";

import { useEffect, useState } from "react";
import CalendarPicker from "./CalendarPicker";
import VisibleToggleField from "./VisibleToggleField";
import AssigneePicker from "./AssigneePicker";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";
import { PRIORITY_LABEL, STATUS_LABEL, commentsOf, initials, relTime } from "./kanbanShared";
import { TASK_KIND_KEYS, kindDef, kindLabel, kindTone } from "@/lib/taskCatalog";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";

export default function TaskDetailPanel({
  task,
  clientName,
  assignees,
  adminReviewers,
  clientReviewers,
  planCandidates = [],
  planoVisibilityOn = false,
  flowFlags = null,
  onClose,
  onExpand,
  onChanged,
}: {
  task: TaskRecord;
  clientName: string;
  assignees: string[];
  adminReviewers: ReviewerCandidate[];
  clientReviewers: ReviewerCandidate[];
  planCandidates?: { id: string; title: string }[];
  planoVisibilityOn?: boolean;
  flowFlags?: ClientFlowFlags | null;
  onClose: () => void;
  onExpand: () => void;
  onChanged: (updated: TaskRecord) => void;
}) {
  const [comment, setComment] = useState("");
  const [description, setDescription] = useState(task.description ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDescription(task.description ?? ""), [task.id, task.description]);

  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const isPlan = kindDef(task.kind).isPlan;
  const comments = commentsOf(task);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (res.ok) onChanged(await res.json());
    } catch { /* keep panel open; user can retry */ }
    setBusy(false);
  }

  function patchPayload(patch2: Record<string, unknown>) {
    return patch({ payload: { ...payload, ...patch2 } });
  }

  async function sendComment() {
    const text = comment.trim();
    if (!text) return;
    const next = [...comments, { author: "Admin North", text, at: new Date().toISOString() }];
    setComment("");
    await patchPayload({ comments: next });
  }

  return (
    <aside className="tdp">
      <div className="tdp-top">
        <span className={`kb-type t-tone-${kindTone(task.kind)}`}>{kindLabel(task.kind)}</span>
        <div className="tdp-top-actions">
          <button className="tdp-icon-btn" onClick={onExpand} aria-label="Expandir">↗</button>
          <button className="tdp-icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
      </div>

      <h2 className="tdp-title">{task.title}</h2>

      <div className="tdp-section">
        <p className="tdp-head">Atributos</p>
        <div className="tdp-attr">
          <span>Status</span>
          <select
            value={task.status}
            disabled={busy}
            onChange={(e) => void patch({ status: e.target.value as TaskStatus })}
          >
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="tdp-attr">
          <span>Prioridade</span>
          <select value={task.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value as TaskPriority })}>
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="tdp-attr">
          <span>Responsável</span>
          <AssigneePicker
            value={task.assignee ?? ""}
            options={assignees}
            disabled={busy}
            onChange={(value) => void patch({ assignee: value || null })}
          />
        </div>
        {/* flowFlags starts null while its fetch is in flight — treat that as
            "off" (hidden), not "on", so the field loads already hidden instead
            of flashing visible then disappearing once the real value arrives. */}
        {flowFlags?.revisaoAdmin === true ? (
          <div className="tdp-attr">
            <span>Revisor</span>
            <select
              value={task.reviewer_id ?? ""} disabled={busy}
              onChange={(e) => patch({ reviewer_id: e.target.value || null, requires_review: Boolean(e.target.value) })}
            >
              <option value="">— Sem revisor —</option>
              {adminReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        ) : null}
        {flowFlags?.aprovacaoAdmin === true ? (
          <div className="tdp-attr">
            <span>Aprovador</span>
            <select
              value={task.approver_id ?? ""} disabled={busy}
              onChange={(e) => patch({ approver_id: e.target.value || null, requires_approval: Boolean(e.target.value) })}
            >
              <option value="">— Sem aprovação —</option>
              {clientReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        ) : null}
        {!isPlan ? (
          <div className="tdp-attr">
            <span>Plano de Ação</span>
            <select
              value={task.plan_id ?? ""} disabled={busy}
              onChange={(e) => patch({ plan_id: e.target.value || null })}
            >
              <option value="">— Sem plano —</option>
              {planCandidates.filter((p) => p.id !== task.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        ) : null}
        <div className="tdp-attr">
          <span>Prazo</span>
          <CalendarPicker value={task.due_date ?? ""} onChange={(v) => patch({ due_date: v || null })} placeholder="Sem prazo" recurrence={{ cadence: task.recurrence_cadence, weekdays: task.recurrence_weekdays, dayOfMonth: task.recurrence_day_of_month }} onRecurrenceChange={(value) => patch({ recurrence_cadence: value.cadence, recurrence_weekdays: value.weekdays, recurrence_day_of_month: value.dayOfMonth })} />
        </div>
        {isPlan ? (
          <div className="tdp-attr">
            <span>Progresso</span>
            <span className="tdp-attr-static">Média das tarefas</span>
          </div>
        ) : null}
        <div className="tdp-attr">
          <span>Cliente</span>
          <span className="tdp-attr-static">{clientName}</span>
        </div>
        <div className="tdp-attr">
          <span>Tipo</span>
          <select value={task.kind} disabled={busy} onChange={(e) => patch({ kind: e.target.value })}>
            {TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
        </div>
        {shouldRenderClientVisibilityToggle(planoVisibilityOn) ? (
          <div className="tdp-visible">
            <VisibleToggleField
              label={isPlan ? "Plano visível para o cliente" : "Visível no Plano de Ação do cliente"}
              checked={task.client_visible}
              onChange={(v) => patch({ client_visible: v })}
              disabled={busy}
            />
          </div>
        ) : null}
      </div>

      <div className="tdp-section">
        <p className="tdp-head">Descrição</p>
        <textarea
          className="tdp-desc"
          rows={3}
          value={description}
          placeholder="Sem descrição."
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => { if (description !== (task.description ?? "")) patch({ description: description.trim() || null }); }}
        />
      </div>

      <div className="tdp-section tdp-activity">
        <p className="tdp-head">Atividade</p>
        <div className="tdp-comments">
          {comments.slice().reverse().map((c, i) => (
            <div className="tdp-comment" key={i}>
              <span className="tdp-comment-av">{initials(c.author)}</span>
              <div>
                <p className="tdp-comment-meta"><b>{c.author}</b><small>{relTime(c.at)}</small></p>
                <p className="tdp-comment-text">{c.text}</p>
              </div>
            </div>
          ))}
          {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
        </div>
        <div className="tdp-comment-input">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void sendComment(); }}
            placeholder="Adicionar comentário…"
          />
          <button className="admin-btn ghost" onClick={sendComment} disabled={!comment.trim() || busy}>Enviar</button>
        </div>
      </div>
    </aside>
  );
}
