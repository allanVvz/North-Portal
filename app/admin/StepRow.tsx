"use client";

import { useState, type ReactNode } from "react";
import TaskKindIcon from "./TaskKindIcon";
import MentionTextarea from "./MentionTextarea";
import CommentAvatar from "./CommentAvatar";
import CommentText from "@/app/CommentText";
import { COLUMNS } from "./kanbanShared";
import { DEADLINE_LABEL, deadlineStateOf } from "./deadlineState";
import { agencyToday } from "./recurringState";
import { commentsOf, formatCommentTime } from "@/lib/comments";
import type { ReviewerCandidate, TaskRecord, TaskStatus } from "@/lib/validation";

// Uma etapa (ou atividade) minimizada, editável na própria linha — ATA 14/09,
// "referência do Monday": cada tarefa lista as etapas no mesmo card com STATUS,
// DATA PREVISTA e RESPONSÁVEL, um check para concluir sem abrir o card, e o
// ícone de comentário da etapa.
//
// Uma linha só (15/09): os rótulos em caixa-alta em cima de cada campo dobravam
// a altura de toda lista de etapas sem dizer nada que o próprio valor não diga.
// Eles viraram aria-label/title. O selo de situação só aparece quando pede ação
// (atrasada/parada) — "No prazo" em toda linha era ruído, e concluída já está
// no check e no fundo da linha.
//
// Cada mudança de data ou responsável é um PATCH no card desta linha. A linha
// de uma Entrega no Plano grava esses metadados no Criativo, sem tocar na etapa
// compartilhada. O status contextual usa a rota da Entrega no TaskModal.

export type StepPatch = {
  status?: TaskStatus;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  assignee?: string | null;
  assignee_profile_ids?: string[];
};

function CommentIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 11.5H7l-3.5 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export default function StepRow({
  card,
  label,
  showCardTitle = false,
  leadingIcon,
  isCurrent = false,
  isOpenCard = false,
  team,
  busy,
  canOpen,
  onOpen,
  onUnlink,
  unlinkTitle,
  trailingAction,
  onPatch,
  onComment,
  lockDateWhenDone = false,
  editableFields = "all",
  statusTitle,
}: {
  card: TaskRecord;
  label: string;
  showCardTitle?: boolean;
  leadingIcon?: ReactNode;
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
  trailingAction?: ReactNode;
  onPatch: (card: TaskRecord, patch: StepPatch) => Promise<void>;
  onComment: (card: TaskRecord, text: string) => Promise<void>;
  /** Só a caixa "Execuções da recorrência" do MOLDE usa isto: concluída, a
   * data desta linha trava — é o check do ciclo, sem log à parte. Abrir a
   * própria execução (o card filho) continua liberando a data normalmente,
   * porque esta trava é só do jeito que o MOLDE mostra a linha, não um
   * estado do card. */
  lockDateWhenDone?: boolean;
  /** Entregas editam prazo e responsável próprios; andamento vem da etapa atual. */
  editableFields?: "all" | "status" | "status_details" | "none";
  statusTitle?: string;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const state = deadlineStateOf(card, agencyToday());
  const comments = commentsOf(card.payload);
  const done = card.status === "aprovado";
  const assigneeId = card.assignee_profile_ids?.find((id) => team.some((member) => member.id === id))
    ?? team.find((member) => member.label === card.assignee)?.id ?? "";
  const disabled = busy || saving || isOpenCard;
  const dateLocked = lockDateWhenDone && done;
  const showState = state === "atrasada" || state === "parada";
  const detailsEditable = editableFields === "all" || editableFields === "status_details";
  const isDeliveryDetails = editableFields === "status_details";

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
      {/* Não usar .tm-step-line: é o traço absoluto de 2px do stepper, e a
          linha inteira (check, título, comentários) sumia atrás do conteúdo. */}
      <div className="tm-steprow-head">
        {editableFields === "all" ? <input
          type="checkbox"
          className="tm-step-check"
          checked={done}
          disabled={disabled}
          onChange={(event) => void run({ status: event.target.checked ? "aprovado" : "em_producao" })}
          title={done ? "Reabrir" : "Concluir sem abrir o card"}
          aria-label={done ? `Reabrir ${label}` : `Concluir ${label}`}
        /> : <span className="tm-step-check" aria-hidden="true" />}
        {showState ? <span className={`kb-situacao s-${state}`}>{DEADLINE_LABEL[state]}</span> : null}
        <button type="button" className="tm-member-open" onClick={onOpen} disabled={!canOpen || busy || isOpenCard} title={`Abrir ${card.title}`}>
          {leadingIcon ?? <TaskKindIcon kind={card.kind} size="sm" />}
          {showCardTitle ? <span className="tm-member-title" title={card.title}>{card.title}</span> : <span className="tm-member-title">{label}</span>}
          {isCurrent ? <span className="tm-step-current">etapa atual</span> : null}
          {isOpenCard ? <span className="tm-member-status">você está aqui</span> : <span className="tm-member-arrow" aria-hidden>↗</span>}
        </button>

        <div className="tm-step-fields">
          <select
            className="tm-step-status"
            aria-label={`Status de ${label}`}
            title={statusTitle ?? (editableFields === "none" ? "Abra o card para editar a etapa" : "Status")}
            value={card.status}
            disabled={disabled || editableFields === "none"}
            onChange={(event) => void run({ status: event.target.value as TaskStatus })}
          >
            {COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}
          </select>
          {detailsEditable ? <><input
            type="date"
            className="tm-step-date"
            aria-label={`${isDeliveryDetails ? "Prazo da Entrega" : "Data prevista"} de ${label}`}
            title={dateLocked ? "Data travada — ciclo concluído. Abra a execução para alterar." : isDeliveryDetails ? "Prazo desta Entrega" : "Data prevista"}
            value={card.due_date ?? ""}
            disabled={disabled || dateLocked}
            onChange={(event) => {
              const value = event.target.value || null;
              void run({ due_date: value, start_date: value, end_date: value });
            }}
          />
          <select
            className="tm-step-assignee"
            aria-label={`${isDeliveryDetails ? "Responsável pela Entrega" : "Responsável por"} ${label}`}
            title={isDeliveryDetails ? "Responsável por esta Entrega" : "Responsável"}
            value={assigneeId}
            disabled={disabled}
            onChange={(event) => {
              const member = team.find((candidate) => candidate.id === event.target.value);
              void run(member ? { assignee: member.label, assignee_profile_ids: [member.id] } : { assignee: null, assignee_profile_ids: [] });
            }}
          >
            <option value="">{card.assignee && !assigneeId ? card.assignee : "Sem responsável"}</option>
            {team.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
          </select></> : null}
        </div>

        <button
          type="button"
          className={`tm-step-comments${commentsOpen ? " on" : ""}${comments.length ? " has" : ""}`}
          onClick={() => setCommentsOpen((open) => !open)}
          aria-expanded={commentsOpen}
          aria-label={`Comentários de ${label} (${comments.length})`}
          title={`Comentários de ${label}`}
        >
          <CommentIcon /> {comments.length}
        </button>
        {onUnlink ? (
          <button type="button" className="tm-member-unlink" title={unlinkTitle} aria-label={unlinkTitle} onClick={onUnlink} disabled={busy}>✕</button>
        ) : null}
        {trailingAction}
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
