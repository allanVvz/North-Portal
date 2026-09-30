"use client";

// A coluna "Comentários e atividade" do modal do card: a lista, uma linha
// pequena dizendo para qual card vai o comentário e, para quem revisa, os
// botões Aprovar / Solicitar revisão.
//
// Uma coisa por vez, nunca duas linhas de texto ao mesmo tempo:
//   1. O revisor vê os dois botões no lugar do campo (e "Só comentar").
//   2. Escolhida a decisão, o MESMO campo de sempre aparece para o mesmo card,
//      e o botão de envio diz o que vai acontecer. Aprovar aceita texto
//      opcional (vai junto da decisão, como justificativa); Solicitar revisão
//      pede o que ajustar (vai como comentário, que é o que o editor e a
//      automação de relatórios leem).
//   3. Decidido, a linha mostra o resultado e "Próximo", que leva ao próximo
//      card em Revisão do plano, na ordem.
// Comentário livre continua sendo só comentário. Quem decide é o servidor
// (rota review-decision); destino e endpoints vêm de lib/commentTargets.ts.

import { useMemo, useRef, useState } from "react";
import HeadDropdown from "./HeadDropdown";
import TaskCommentComposer from "./TaskCommentComposer";
import TaskCommentThread, { threadCommentsOf, type CommentAsset } from "./TaskCommentThread";
import { createCommentIdRegistry } from "./commentIds";
import { STATUS_LABEL } from "./kanbanShared";
import {
  canDecide, commentRequestOf, commentTargetsOf, isPlanRoot, reviewDecisionRequestOf, reviewQueueOf,
  type CommentTarget, type ReviewDecision,
} from "@/lib/commentTargets";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import { flowStepsOf } from "@/lib/taskRelations";
import type { ConversationItem } from "@/lib/cardConversation";
import type { AdminDocument } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

type Intent = "approve" | "request_changes" | "comment" | null;

const DONE_LABEL: Record<ReviewDecision, string> = { approve: "✓ Aprovado", request_changes: "↺ Revisão solicitada" };

export default function TaskCommentsBox({
  openCard, tasks, cardsById, draftKind, currentStepId, contextDeliveryId, decisionsAllowed,
  currentUserId, tone, conversation, assets, docsReady, attachDocs, assetIds, onAssetIdsSent,
  onOpenLink, isKnownDoc, onOpenAsset, onOpenCard, onPatched, onError,
}: {
  openCard: TaskRecord;
  tasks: readonly TaskRecord[];
  cardsById: ReadonlyMap<string, TaskRecord>;
  draftKind: string;
  /** Na Entrega, a etapa que a tela mostra como corrente: o destino padrão. */
  currentStepId: string | null;
  /** Numa etapa aberta direto, a Entrega de contexto (quando é uma só). */
  contextDeliveryId: string | null;
  /** Etapa compartilhada aberta direto: decide-se dentro da Entrega, não aqui. */
  decisionsAllowed: boolean;
  currentUserId: string | null;
  tone: string;
  conversation: { ready: boolean; items: ConversationItem[]; reload: () => void };
  assets: ReadonlyMap<string, CommentAsset>;
  docsReady: boolean;
  attachDocs: readonly AdminDocument[];
  /** Arquivos do Drive escolhidos para ir junto do próximo comentário. */
  assetIds: readonly string[];
  onAssetIdsSent: () => void;
  onOpenLink: (url: string) => boolean;
  isKnownDoc: (url: string) => boolean;
  onOpenAsset: (creativeTaskId: string, assetId: string) => void;
  onOpenCard?: (card: TaskRecord) => void;
  onPatched: (updated: TaskRecord) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [contextError, setContextError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [decided, setDecided] = useState<{ key: string; decision: ReviewDecision } | null>(null);
  const [doneKeys, setDoneKeys] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  // Chave idempotente: retry e clique duplo colidem no mesmo id.
  const commentIds = useRef(createCommentIdRegistry()).current;
  const requestIds = useRef(new Map<string, string>());

  const { ready: conversationReady, items: conversationItems } = conversation;
  const comments = useMemo(() => threadCommentsOf({ ready: conversationReady, items: conversationItems }, openCard, tasks, draftKind), [conversationReady, conversationItems, openCard, tasks, draftKind]);
  const targets = useMemo(() => commentTargetsOf(openCard, tasks, { contextDeliveryId }), [openCard, tasks, contextDeliveryId]);
  const queue = decisionsAllowed ? reviewQueueOf(targets, currentUserId).filter((target) => !doneKeys.has(target.key)) : [];
  const isPlan = isPlanRoot(openCard);
  const fallback = queue[0] ?? targets.find((target) => target.card.id === currentStepId) ?? targets[0];
  const focus = targets.find((target) => target.key === focusKey) ?? fallback;
  const justDecided = decided && decided.key === focus.key ? decided.decision : null;
  const decidable = decisionsAllowed && !justDecided && !doneKeys.has(focus.key) && canDecide(focus, currentUserId);
  const choosing = decidable && intent === null;
  const decisionIntent = decidable && (intent === "approve" || intent === "request_changes") ? intent : null;
  const queueIndex = queue.findIndex((target) => target.key === focus.key);
  const next = queue.find((target) => target.key !== focus.key) ?? null;
  const openable = onOpenCard && !focus.post.planNote && focus.card.id !== openCard.id;
  const showTargetLine = targets.length > 1 || focus.card.id !== openCard.id || decidable || Boolean(justDecided);

  function goTo(key: string | null) {
    setFocusKey(key);
    setIntent(null);
    setDecided(null);
    setDecisionError("");
  }

  function choose(nextIntent: Intent) {
    setFocusKey(focus.key); // decidir e comentar valem para ESTE card, mesmo que a fila mude
    setIntent(nextIntent);
    setDecisionError("");
  }

  async function reloadAround(target: CommentTarget) {
    conversation.reload();
    const deliveryId = target.deliveryId;
    const urls = deliveryId
      ? [`/api/admin/tasks?parentId=${encodeURIComponent(deliveryId)}`, `/api/admin/tasks/${deliveryId}`]
      : [`/api/admin/tasks/${target.card.id}`];
    await Promise.all(urls.map((url) => fetch(url, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<TaskRecord | { tasks?: TaskRecord[] }> : null)
      .then((body) => {
        if (!body) return;
        if ("tasks" in body) (body.tasks ?? []).forEach(onPatched);
        else onPatched(body as TaskRecord);
      })
      .catch(() => {})));
  }

  async function postDecision(target: CommentTarget, decision: ReviewDecision, justification?: string): Promise<boolean> {
    const requestKey = `${target.key}:${decision}`;
    const requestId = requestIds.current.get(requestKey) ?? crypto.randomUUID();
    requestIds.current.set(requestKey, requestId);
    const { url, body } = reviewDecisionRequestOf(target, decision, requestId);
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(justification ? { justification } : {}) }),
    }).catch(() => null);
    if (!response) { setDecisionError("Falha de conexão. Tente de novo; a mesma decisão será reaproveitada."); return false; }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      setDecisionError(response.status === 409 ? "O status deste card mudou. Atualize o card para decidir." : payload?.error || "Não foi possível registrar a decisão.");
      return false;
    }
    requestIds.current.delete(requestKey);
    setDoneKeys((current) => new Set(current).add(target.key));
    setDecided({ key: target.key, decision });
    return true;
  }

  async function postComment(target: CommentTarget, body: string): Promise<boolean> {
    const { url, body: payload } = commentRequestOf(target, { text: body, commentId: commentIds.idFor(target.key, body), assetIds });
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (error.code === "COMMENT_STAGE_INVALID") setContextError(error.error ?? "A etapa mudou enquanto você escrevia. Atualize o destino antes de reenviar.");
        throw new Error(error.error ?? "");
      }
      setContextError(null);
      commentIds.settle(target.key, body);
      setText((current) => current.trim() === body ? "" : current);
      onAssetIdsSent();
      conversation.reload();
      // Comentar na Entrega grava na etapa: o servidor pode devolver outro
      // card, e o modal decide o que atualizar (ver onPatched no TaskModal).
      onPatched(await res.json() as TaskRecord);
      return true;
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : "Não foi possível enviar o comentário.");
      return false;
    }
  }

  async function submit() {
    if (busy) return;
    const body = text.trim();
    const target = focus;
    if (!decisionIntent) {
      if (body) await postComment(target, body);
      return;
    }
    if (decisionIntent === "request_changes" && !body) return;
    setBusy(true);
    try {
      if (decisionIntent === "approve") {
        if (!(await postDecision(target, "approve", body || undefined))) return;
        setText("");
      } else {
        // Decide antes: se o status mudou, nada é gravado e o texto fica na
        // caixa. O pedido vai como comentário, que o editor e a automação de
        // relatórios já leem.
        if (!(await postDecision(target, "request_changes"))) return;
        await postComment(target, body);
      }
      setIntent(null);
      await reloadAround(target);
    } finally {
      setBusy(false);
    }
  }

  // Um COMMENT_STAGE_INVALID: a Entrega andou enquanto a pessoa escrevia.
  // Relê as etapas e aponta o destino para a etapa corrente de agora.
  async function refreshContext(): Promise<string | void> {
    const deliveryId = focus.post.stageTaskId ? focus.post.taskId : null;
    if (!deliveryId) {
      const response = await fetch(`/api/admin/tasks/${focus.card.id}`, { cache: "no-store" });
      if (!response.ok) return;
      onPatched(await response.json() as TaskRecord);
      setContextError(null);
      return focus.key;
    }
    const response = await fetch(`/api/admin/tasks?parentId=${encodeURIComponent(deliveryId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const fresh = ((await response.json()) as { tasks?: TaskRecord[] }).tasks ?? [];
    fresh.forEach(onPatched);
    const current = currentFlowStepOf(flowStepsOf(deliveryId, fresh));
    if (!current) return;
    const key = `${current.id}@${deliveryId}`;
    setContextError(null);
    goTo(key);
    conversation.reload();
    return key;
  }

  function attachDoc(doc: AdminDocument) {
    // [label](url) renders as a short link (the file's own name) instead of
    // the raw URL — see lib/comments.ts splitCommentText.
    const link = doc.file_url ? `📎 [${doc.name}](${doc.file_url})` : `📎 ${doc.name}`;
    setText((current) => (current.trim() ? `${current}\n${link}` : link));
  }

  const shortLabel = focus.label;
  const placeholder = decisionIntent === "approve"
    ? `Comentário sobre a aprovação (opcional)…`
    : decisionIntent === "request_changes"
      ? `O que precisa ajustar em "${shortLabel}"?`
      : "Escrever comentário… use @ para chamar alguém";

  return (
    <div className="tm-box tm-commentsbox">
      <p className="tm-box-label">Comentários e atividade</p>
      <TaskCommentThread
        comments={comments}
        openCard={openCard}
        cardsById={cardsById}
        currentUserId={currentUserId}
        tone={tone}
        assets={assets}
        docsReady={docsReady}
        onOpenLink={onOpenLink}
        isKnownDoc={isKnownDoc}
        onOpenAsset={onOpenAsset}
        onPatched={(updated) => { onPatched(updated); conversation.reload(); }}
        onError={onError}
      />

      <div className="tm-composer">
        {showTargetLine ? (
          <div className="tm-comment-target">
            <span className="tm-comment-target-label" title={focus.label}>
              <span aria-hidden>→</span> <b>{focus.label}</b>
              {justDecided ? <span className={`tm-comment-target-done is-${justDecided}`}>{DONE_LABEL[justDecided]}</span>
                : focus.card.status === "revisao" && !focus.post.planNote ? <span className="tm-comment-target-status">{STATUS_LABEL.revisao}</span> : null}
              {queueIndex >= 0 && queue.length > 1 ? <span className="tm-comment-target-count">{queueIndex + 1} de {queue.length}</span> : null}
            </span>
            <span className="tm-comment-target-actions">
              {decisionIntent ? <button type="button" onClick={() => setIntent(null)} disabled={busy}>Cancelar</button> : null}
              {intent === "comment" && decidable ? <button type="button" onClick={() => setIntent(null)}>Decidir</button> : null}
              {justDecided && next ? <button type="button" className="is-next" onClick={() => goTo(next.key)}>Próximo →</button> : null}
              {openable ? <button type="button" onClick={() => onOpenCard?.(focus.deliveryId && isPlan ? cardsById.get(focus.deliveryId) ?? focus.card : focus.card)}>Abrir</button> : null}
              {isPlan && targets.length > 1 ? (
                <HeadDropdown className="tm-comment-target-pick" trigger={<span>Mudar</span>}>
                  {targets.map((target) => (
                    <button type="button" key={target.key} className={`tm-headpick-option${target.key === focus.key ? " on" : ""}`} onClick={() => goTo(target.key)}>
                      <span className="tm-comment-target-option">{target.label}</span>
                      {!target.post.planNote && target.card.status === "revisao" ? <small className="tm-comment-target-status">{STATUS_LABEL.revisao}</small> : null}
                    </button>
                  ))}
                </HeadDropdown>
              ) : null}
            </span>
          </div>
        ) : null}

        {choosing ? (
          <div className="tm-review-decision" role="group" aria-label={`Decisão sobre ${focus.label}`}>
            <button type="button" className={`admin-btn primary tm-btn-${tone}`} onClick={() => choose("approve")}>✓ Aprovar</button>
            <button type="button" className="admin-btn ghost" onClick={() => choose("request_changes")}>↺ Solicitar revisão</button>
            <button type="button" className="tm-review-skip" onClick={() => choose("comment")}>Só comentar</button>
          </div>
        ) : (
          <TaskCommentComposer
            value={text}
            onChange={setText}
            onSubmit={() => void submit()}
            targetKey={focus.key}
            contextError={contextError}
            onRefreshContext={refreshContext}
            placeholder={placeholder}
            sendLabel={decisionIntent === "approve" ? (busy ? "Aprovando…" : "Aprovar") : decisionIntent === "request_changes" ? (busy ? "Enviando…" : "Solicitar revisão") : "Enviar"}
            allowEmpty={decisionIntent === "approve"}
            disabled={busy}
            tone={tone}
            leading={<HeadDropdown className="tm-comment-attach" trigger={<span aria-hidden>📎</span>}>
              {attachDocs.length === 0 ? <p className="tm-member-search-empty">Nenhum documento para anexar.</p> : attachDocs.map((d) => <button type="button" key={d.id} className="tm-headpick-option" onClick={() => attachDoc(d)}>{d.name}</button>)}
            </HeadDropdown>}
          />
        )}
        {decisionError ? <p className="tm-review-error" role="alert">{decisionError}</p> : null}
      </div>
    </div>
  );
}
