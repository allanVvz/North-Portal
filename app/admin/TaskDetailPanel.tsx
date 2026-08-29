"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CalendarPicker from "./CalendarPicker";
import { AutoGrowTextarea } from "./TaskModal";
import VisibleToggleField from "./VisibleToggleField";
import AssigneePicker from "./AssigneePicker";
import TaskKindIcon from "./TaskKindIcon";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";
import { PRIORITY_LABEL, STATUS_LABEL, commentsOf, initials } from "./kanbanShared";
import CommentAvatar from "./CommentAvatar";
import CardCover from "./CardCover";
import { taskCoverCandidates } from "@/lib/taskCover";
import CommentText from "@/app/CommentText";
import { useCurrentAdminUser } from "./CurrentUserContext";
import { formatCommentTime } from "@/lib/comments";
import { TASK_KIND_KEYS, kindDef, kindLabel } from "@/lib/taskCatalog";
import { parentIdsOf } from "@/lib/taskRelations";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { useTaskAutosave } from "./useTaskAutosave";

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
  const { name: currentUserName } = useCurrentAdminUser();
  const [busy, setBusy] = useState(false);
  useEffect(() => setDescription(task.description ?? ""), [task.id, task.description]);

  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const isPlan = kindDef(task.kind).isPlan;
  const comments = commentsOf(task);
  const descriptionValues = useMemo(() => ({ description: description.trim() || null }), [description]);
  const descriptionSaved = useCallback((updated: TaskRecord) => onChanged(updated), [onChanged]);
  const autosave = useTaskAutosave({ taskId: task.id, values: descriptionValues, enabled: true, textKeys: ["description"], onSaved: descriptionSaved });

  async function closeAfterSave(action = onClose) {
    if (await autosave.flush()) action();
  }

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
    setComment("");
    try {
      const res = await fetch(`/api/admin/tasks/${task.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error();
      onChanged(await res.json());
    } catch { setComment(text); }
  }

  const coverCandidates = taskCoverCandidates(task);

  return (
    <aside className="tdp">
      {coverCandidates.length ? (
        <CardCover candidates={coverCandidates} title={task.title} className="tdp-cover" />
      ) : null}
      <div className="tdp-top">
        <div className="tdp-top-actions">
          <button className="tdp-icon-btn" onClick={() => void closeAfterSave(onExpand)} aria-label="Expandir">↗</button>
          <button className="tdp-icon-btn" onClick={() => void closeAfterSave()} aria-label="Fechar">✕</button>
        </div>
      </div>

      <div className="tdp-titleline">
        <TaskKindIcon kind={task.kind} size="lg" />
        <h2 className="tdp-title">{task.title}</h2>
      </div>

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
            assignee={task.assignee}
            assigneeProfileIds={task.assignee_profile_ids}
            accountOptions={adminReviewers}
            freeTextOptions={assignees}
            disabled={busy}
            onChange={({ assignee, assigneeProfileIds }) => void patch({ assignee, assignee_profile_ids: assigneeProfileIds })}
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
              value={parentIdsOf(task)[0] ?? ""} disabled={busy}
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
          onBlur={() => void autosave.flush()}
        />
        <span className={`tm-autosave tm-autosave-${autosave.state}`} role="status" aria-live="polite">
          {autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "saving" ? "Salvando…" : autosave.state === "error" ? <button type="button" onClick={() => void autosave.retry()}>Erro ao salvar — Tentar novamente</button> : "Salvo"}
        </span>
      </div>

      <div className="tdp-section tdp-activity">
        <p className="tdp-head">Atividade</p>
        <div className="tdp-comments">
          {comments.slice().reverse().map((c, i) => (
            <div className="tdp-comment" key={i}>
              <CommentAvatar comment={c} className="tdp-comment-av" />
              <div>
                <p className="tdp-comment-meta"><b>{c.author}</b><small>{formatCommentTime(c.at)}</small></p>
                <p className="tdp-comment-text"><CommentText text={c.text} /></p>
              </div>
            </div>
          ))}
          {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
        </div>
        <div className="tdp-comment-input">
          <AutoGrowTextarea
            rows={1}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendComment(); }
            }}
            placeholder="Adicionar comentário…"
          />
          <button className="admin-btn ghost" onClick={sendComment} disabled={!comment.trim() || busy}>Enviar</button>
        </div>
      </div>
    </aside>
  );
}
