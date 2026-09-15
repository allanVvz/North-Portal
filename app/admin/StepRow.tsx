"use client";

import { useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import MentionTextarea from "./MentionTextarea";
import CommentAvatar from "./CommentAvatar";
import CommentText from "@/app/CommentText";
import { COLUMNS } from "./kanbanShared";
import { DEADLINE_LABEL, deadlineStateOf } from "./deadlineState";
import { todayInTimezone } from "./recurringState";
import { commentsOf, formatCommentTime } from "@/lib/comments";
import type { ReviewerCandidate, TaskRecord, TaskStatus } from "@/lib/validation";

// Uma etapa (ou atividade) minimizada, editável na própria linha — ATA 14/09,
// "referência do Monday": cada tarefa lista as etapas no mesmo card com STATUS,
// DATA PREVISTA e RESPONSÁVEL, um check para concluir sem abrir o card, e o
// ícone de comentário da etapa (os comentários de roteiro ficam no roteiro, os
// de edição na edição).
//
// Cada mudança é um PATCH no card da ETAPA — o mesmo que abrir e editar —, então
// a cascata, as notificações e o autosave do servidor valem igual.

export type StepPatch = {
  status?: TaskStatus;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  assignee?: string | null;
  assignee_profile_ids?: string[];
};

export default function StepRow({
  card,
  label,
  isCurrent = false,
  isOpenCard = false,
  team,
  busy,
  canOpen,
  onOpen,
  onUnlink,
  unlinkTitle,
  onPatch,
  onComment,
}: {
  card: TaskRecord;
  label: string;
  /** A etapa em que a corrente está agora — o pai espelha esta. */
  isCurrent?: boolean;
  /** O card aberto no modal: não se edita pela linha (o formulário está aberto). */
  isOpenCard?: boolean;
  team: ReviewerCandidate[];
  busy: boolean;
  canOpen: boolean;
  onOpen: () => void;
  onUnlink?: () => void;
  unlinkTitle?: string;
  onPatch: (card: TaskRecord, patch: StepPatch) => Promise<void>;
  onComment: (card: TaskRecord, text: string) => Promise<void>;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const state = deadlineStateOf(card, todayInTimezone("America/Sao_Paulo"));
  const comments = commentsOf(card.payload);
  const done = card.status === "aprovado";
  const assigneeId = card.assignee_profile_ids?.[0] ?? team.find((member) => member.label === card.assignee)?.id ?? "";
  const disabled = busy || saving || isOpenCard;

  async function run(patch: StepPatch) {
    setSaving(true);
    try {
      await onPatch(card, patch);
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      await onComment(card, text);
      setDraft("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`tm-member tm-step-row is-${state}${isCurrent ? " is-current" : ""}${isOpenCard ? " tm-member-current" : ""}`}>
      <div className="tm-step-line">
        <input
          type="checkbox"
          className="tm-step-check"
          checked={done}
          disabled={disabled}
          onChange={(event) => void run({ status: event.target.checked ? "aprovado" : "em_producao" })}
          title={done ? "Reabrir" : "Concluir sem abrir o card"}
          aria-label={done ? `Reabrir ${label}` : `Concluir ${label}`}
        />
        <span className={`kb-situacao s-${state}`}>{DEADLINE_LABEL[state]}</span>
        <button type="button" className="tm-member-open" onClick={onOpen} disabled={!canOpen || busy || isOpenCard}>
          <TaskKindIcon kind={card.kind} size="sm" />
          <span className="tm-member-title">{label}</span>
          {isCurrent ? <span className="tm-step-current">etapa atual</span> : null}
          {isOpenCard ? <span className="tm-member-status">você está aqui</span> : <span className="tm-member-arrow" aria-hidden>↗</span>}
        </button>
        <button
          type="button"
          className={`tm-step-comments${commentsOpen ? " on" : ""}${comments.length ? " has" : ""}`}
          onClick={() => setCommentsOpen((open) => !open)}
          aria-expanded={commentsOpen}
          title={`Comentários de ${label}`}
        >
          💬 {comments.length}
        </button>
        {onUnlink ? (
          <button type="button" className="tm-member-unlink" title={unlinkTitle} aria-label={unlinkTitle} onClick={onUnlink} disabled={busy}>✕</button>
        ) : null}
      </div>

      <div className="tm-step-fields">
        <label className="tm-step-field">
          <span>Status</span>
          <select value={card.status} disabled={disabled} onChange={(event) => void run({ status: event.target.value as TaskStatus })}>
            {COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}
          </select>
        </label>
        <label className="tm-step-field">
          <span>Data prevista</span>
          <input
            type="date"
            value={card.due_date ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value || null;
              void run({ due_date: value, start_date: value, end_date: value });
            }}
          />
        </label>
        <label className="tm-step-field">
          <span>Responsável</span>
          <select
            value={assigneeId}
            disabled={disabled}
            onChange={(event) => {
              const member = team.find((candidate) => candidate.id === event.target.value);
              void run(member ? { assignee: member.label, assignee_profile_ids: [member.id] } : { assignee: null, assignee_profile_ids: [] });
            }}
          >
            <option value="">{card.assignee && !assigneeId ? card.assignee : "— Sem responsável —"}</option>
            {team.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
          </select>
        </label>
      </div>

      {commentsOpen ? (
        <div className="tm-step-thread">
          {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário em {label} ainda.</p> : null}
          {comments.slice(-5).map((comment, index) => (
            <div className="tm-step-comment" key={`${comment.at}-${index}`}>
              <CommentAvatar comment={comment} className="tm-comment-av" />
              <div>
                <p className="tm-comment-meta"><b>{comment.author}</b><small>{formatCommentTime(comment.at)}</small></p>
                <p className="tm-comment-text"><CommentText text={comment.text} /></p>
              </div>
            </div>
          ))}
          {comments.length > 5 ? <p className="admin-sub" style={{ margin: 0 }}>Mostrando os 5 mais recentes — abra a etapa para ver todos.</p> : null}
          <div className="tm-step-comment-input">
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              onSubmit={() => void send()}
              placeholder={`Comentar em ${label}… use @`}
              disabled={busy || saving}
            />
            <button type="button" className="admin-btn primary" onClick={() => void send()} disabled={busy || saving || !draft.trim()}>Enviar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
