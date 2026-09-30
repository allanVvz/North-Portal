"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarPicker from "./CalendarPicker";
import { createCommentIdRegistry } from "./commentIds";
import TaskCommentComposer from "./TaskCommentComposer";
import VisibleToggleField from "./VisibleToggleField";
import AssigneePicker from "./AssigneePicker";
import TaskReviewerPicker from "./TaskReviewerPicker";
import TaskKindIcon from "./TaskKindIcon";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";
import { PRIORITY_LABEL, STATUS_LABEL, initials } from "./kanbanShared";
import CommentAvatar from "./CommentAvatar";
import CardCover from "./CardCover";
import { taskCoverCandidates } from "@/lib/taskCover";
import CommentText from "@/app/CommentText";
import { useCurrentAdminUser } from "./CurrentUserContext";
import { familyThreadOf, formatCommentTime } from "@/lib/comments";
import { kindDef } from "@/lib/taskCatalog";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { TASK_BASE_TYPES, classifyTask, deliverySubtypeTypes, type TaskBaseTypeKey } from "@/lib/taskClassification";
import { flowStepsOf, isFlowDelivery, planParentIdOf } from "@/lib/taskRelations";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { useTaskAutosave } from "./useTaskAutosave";
import TaskReviewActions from "./TaskReviewActions";
import { useTaskConversation } from "./useTaskConversation";
import type { ConversationItem } from "@/lib/cardConversation";
import TaskMaterialsPanel from "./TaskMaterialsPanel";

const EMPTY_CLIENT_TASKS: TaskRecord[] = [];

export default function TaskDetailPanel({
  task,
  clientName,
  assignees,
  adminReviewers,
  clientReviewers,
  planCandidates = [],
  clientTasks = EMPTY_CLIENT_TASKS,
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
  /** O quadro inteiro do cliente — o painel precisa dele para montar o thread
   *  da família quando o card aberto é um pai. Sem ele o painel cai no
   *  comportamento antigo (só os comentários do próprio card). */
  clientTasks?: TaskRecord[];
  planoVisibilityOn?: boolean;
  flowFlags?: ClientFlowFlags | null;
  onClose: () => void;
  onExpand: () => void;
  onChanged: (updated: TaskRecord) => void;
}) {
  const [comment, setComment] = useState("");
  const commentIds = useRef(createCommentIdRegistry()).current;
  const [commentError, setCommentError] = useState("");
  const [description, setDescription] = useState(task.description ?? "");
  const { name: currentUserName, userId: currentUserId } = useCurrentAdminUser();
  const [busy, setBusy] = useState(false);
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([]);
  useEffect(() => setDescription(task.description ?? ""), [task.id, task.description]);
  useEffect(() => {
    fetch("/api/admin/task-types")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data?.types)) setTaskTypes(data.types as TaskTypeDef[]); })
      .catch(() => {});
  }, []);
  // O painel e o modal usam a mesma classificação e a mesma trava da corrente.
  const classification = classifyTask(task.kind, task.subtype, taskTypes);
  const deliveryClassificationLocked = isFlowDelivery(task) && flowStepsOf(task.id, clientTasks).some((step) => step.status !== "backlog");
  const deliveryOptions = deliverySubtypeTypes(taskTypes, task.kind);
  const subtypeOptions = classification.baseType === "entrega" ? deliveryOptions : classification.baseType === "tarefa"
    ? taskTypes.find((type) => type.key === "operacional")?.subtypes ?? [] : [];
  function selectBaseType(base: TaskBaseTypeKey) {
    if (base === "entrega") void patch({ kind: deliveryOptions.find((type) => type.key === task.kind)?.key ?? deliveryOptions.find((type) => type.key === "criativo")?.key ?? "criativo", subtype: null });
    else void patch({ kind: base === "plano" ? "plano_acao" : "operacional", subtype: null });
  }

  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const isPlan = kindDef(task.kind).isPlan;
  // Mesma regra do modal, do mesmo lugar: um Plano de Ação ou uma entrega
  // mostram aqui o thread da família. Antes este painel lia só
  // `commentsOf(task)`, então o MESMO card devolvia threads diferentes
  // dependendo de ter sido aberto pelo modal ou pelo painel — e o link
  // `?task=` cai aqui quando a preferência de painel lateral está ligada.
  const comments = useMemo(() => familyThreadOf(task, clientTasks), [task, clientTasks]);
  const conversation = useTaskConversation(task.id);
  const reviewDeliveryLinks = task.parents.filter((parent) => parent.relation_kind === "workflow_step");
  const timeline = useMemo(() => conversation.ready
    ? conversation.items.filter((item) => item.kind === "comment" || item.kind === "event").map((item: ConversationItem) => ({
        taskId: item.taskId, author: item.author ?? "Sistema", text: item.text ?? (item.eventType === "moved_to_review" ? "Movido para revisão" : item.eventType === "review_approved" ? "Aprovado" : item.eventType === "review_changes_requested" ? "Ajustes solicitados" : "Atividade do card"), at: item.at, event: item.kind === "event", taskTitle: item.taskTitle, path: item.path, meetingDate: item.meetingDate,
      }))
    : comments.map((item) => ({ ...item, event: false, taskTitle: undefined, path: undefined, meetingDate: null })), [conversation.items, conversation.ready, comments]);
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
    setCommentError("");
    try {
      // `comment_id` estável enquanto a mensagem está pendente: retry e clique
      // duplo gravam um comentário só (ver app/admin/commentIds.ts).
      const res = await fetch(`/api/admin/tasks/${task.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, comment_id: commentIds.idFor(task.id, text) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      commentIds.settle(task.id, text);
      conversation.reload();
      onChanged(await res.json());
    } catch (e) {
      // O texto volta para a caixa e a pessoa é avisada do motivo — antes a falha era silenciosa.
      setComment(text);
      setCommentError(e instanceof Error && e.message ? e.message : "Não foi possível enviar o comentário.");
    }
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
        <TaskKindIcon kind={task.kind} subtype={task.subtype} format={task.payload?.formato} size="lg" />
        <h2 className="tdp-title">{task.title}</h2>
      </div>

      <div className="tdp-section">
        <p className="tdp-head">Atributos</p>
        <div className="tdp-attr">
          <span>Status</span>
          <select
            value={task.status}
            disabled={busy || (task.status === "revisao" && task.requires_review)}
            title={task.status === "revisao" && task.requires_review ? "Somente o revisor designado pode decidir nesta etapa" : undefined}
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
            northAiResponsible={Boolean(task.north_ai_responsible)}
            onNorthAiResponsibleChange={(assigned) => void patch({ north_ai_responsible: assigned })}
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
            <span>{task.subtype === "edicao" ? "Revisores da Edição" : "Revisor"}</span>
            <TaskReviewerPicker
              reviewerId={task.reviewer_id}
              reviewerIds={Array.isArray(task.payload?.reviewer_ids) ? task.payload.reviewer_ids : []}
              northAiReviewer={Boolean(task.north_ai_reviewer)}
              multiple={task.subtype === "edicao"}
              options={adminReviewers}
              disabled={busy}
              onChange={({ reviewerId, reviewerIds, northAiReviewer }) => void patch({
                reviewer_id: reviewerId,
                north_ai_reviewer: northAiReviewer,
                ...(task.subtype === "edicao" ? { payload_patch: { reviewer_ids: reviewerIds } } : {}),
              })}
            />
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
            {/* Controle de valor único: `planParentIdOf` mostra só um plano
                quando o card pertence a vários (a caixa "Faz parte de" no
                modal mostra todos — ver `planParentIdsOf`). Trocar ou limpar
                mexe só NESSE elo — manda o valor atual como `plan_id_previous`
                pra `setTaskPlanLink` saber qual, sem tocar em outro plano que
                o card já pertença (bug real até 2026-09-2x: limpar soltava
                todos de uma vez). */}
            <span>Plano de Ação</span>
            <select
              value={planParentIdOf(task) ?? ""} disabled={busy}
              onChange={(e) => patch({ plan_id: e.target.value || null, plan_id_previous: planParentIdOf(task) })}
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
        {/* O MESMO vocabulário do card aberto. Este select lia
            `TASK_KIND_KEYS` direto do catálogo em código, sem passar por
            `creatable` nem por `active` — um segundo editor de tipo que
            oferecia opções que o modal já tinha aposentado. */}
        <div className="tdp-attr">
          <span>Tipo</span>
          <select value={classification.baseType} disabled={busy || classification.baseType === "checkpoint" || deliveryClassificationLocked} onChange={(e) => selectBaseType(e.target.value as TaskBaseTypeKey)}>
            {classification.baseType === "checkpoint" ? <option value="checkpoint">Checkpoint</option> : TASK_BASE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        {classification.baseType === "tarefa" || classification.baseType === "entrega" ? <div className="tdp-attr">
          <span>Subtipo</span>
          <select value={classification.subtypeKey ?? ""} disabled={busy || !subtypeOptions.length || deliveryClassificationLocked} onChange={(e) => void patch(classification.baseType === "entrega" ? { kind: e.target.value, subtype: null } : { subtype: e.target.value || null })}>
            {classification.baseType === "tarefa" ? <option value="">Sem subtipo</option> : null}
            {subtypeOptions.map((subtype) => <option key={subtype.key} value={subtype.key} disabled={"creatable" in subtype && !subtype.creatable && subtype.key !== task.kind}>{subtype.label}</option>)}
            {classification.baseType === "entrega" && !subtypeOptions.some((subtype) => subtype.key === task.kind) ? <option value={task.kind} disabled>{classification.subtypeLabel ?? "Carregando subtipos…"}</option> : null}
          </select>
        </div> : null}
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
        {reviewDeliveryLinks.length <= 1 ? <TaskReviewActions taskId={task.id} status={task.status} reviewerIds={Array.isArray(payload.reviewer_ids) ? payload.reviewer_ids.filter((id): id is string => typeof id === "string") : task.reviewer_id ? [task.reviewer_id] : []} currentUserId={currentUserId} deliveryId={reviewDeliveryLinks[0]?.id} onDecided={(updated, effectiveStatus) => onChanged({ ...task, ...updated, status: effectiveStatus ?? updated.status })} /> : <p className="ap-review-context">Abra a Entrega para escolher onde aplicar esta decisão.</p>}
        <div className="tdp-comments">
          {timeline.slice().reverse().map((c, i) => (
            // A chave carrega o card de origem: o thread mescla vários cards da
            // família e `at` só é único DENTRO de um card.
            <div className="tdp-comment" key={`${c.taskId}-${c.at}-${i}`}>
              <CommentAvatar comment={c} className="tdp-comment-av" />
              <div>
              <p className="tdp-comment-meta"><b>{c.author}</b>{c.event ? <small className="tm-activity-kind">Atividade</small> : null}{c.taskId !== task.id ? <small className="tm-comment-origin" title={c.path?.join(" → ")}>→ {c.taskTitle}</small> : null}{c.meetingDate ? <small>Reunião · {c.meetingDate}</small> : null}<small>{formatCommentTime(c.at)}</small></p>
                <p className="tdp-comment-text"><CommentText text={c.text} /></p>
              </div>
            </div>
          ))}
          {timeline.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
        </div>
        <TaskCommentComposer value={comment} onChange={setComment} onSubmit={() => void sendComment()} targetKey={task.id} targetLabel="Comentando neste card" placeholder="Adicionar comentário… use @ para chamar alguém" disabled={busy} tone="neutral" />
        {commentError ? <p className="admin-error">{commentError}</p> : null}
      </div>
      <TaskMaterialsPanel items={conversation.ready ? conversation.items : []} onOpen={(item) => {
        const url = typeof item.file?.file_url === "string" ? item.file.file_url : typeof item.file?.webViewLink === "string" ? item.file.webViewLink : "";
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }} />
    </aside>
  );
}
