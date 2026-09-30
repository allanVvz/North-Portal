"use client";

// A lista "Comentários e atividade" do modal do card. Saiu do TaskModal sem
// mudar nada do que a pessoa vê: avatar, selo de papel, "→ onde foi gravado",
// reunião, hora, "editado", o menu "…" de editar/apagar e os anexos do Drive.

import { useState } from "react";
import CommentAvatar from "./CommentAvatar";
import CommentActionsMenu from "./CommentActionsMenu";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { commentsOf } from "./kanbanShared";
import { formatShortDate } from "./taskDates";
import CommentText from "@/app/CommentText";
import { familyThreadOf, formatCommentTime, type FamilyComment } from "@/lib/comments";
import { subtypeLabel } from "@/lib/taskCatalog";
import { ROLE_LABEL, REVISOR_LABEL, roleTone } from "@/lib/flows/roleTone";
import { stepRoleOf } from "@/lib/flows/stepRole";
import type { ConversationItem } from "@/lib/cardConversation";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import type { TaskRecord } from "@/lib/validation";

export type ThreadComment = FamilyComment & { timelineKind?: "comment" | "event"; taskTitle?: string; path?: string[]; meetingDate?: string | null };
export type CommentAsset = { asset: CreativeMaterialWorkspace["assets"][number]; workspace: CreativeMaterialWorkspace };

// A decisão grava a justificativa como texto do evento; sem o rótulo, a
// lista mostraria só "ok, pode seguir" sem dizer que foi uma aprovação.
const DECISION_EVENTS = new Set(["review_approved", "review_changes_requested"]);

function activityLabel(eventType?: string): string {
  if (eventType === "moved_to_review") return "Movido para revisão";
  if (eventType === "review_approved") return "Aprovado";
  if (eventType === "review_changes_requested") return "Ajustes solicitados";
  return "Atividade do card";
}

/** A conversa canônica do card (rota /conversation) sem os arquivos, que têm
 *  painel próprio. Enquanto ela não chega, a família lida no cliente. O tipo
 *  vem do RASCUNHO, não do card salvo: trocar o tipo no formulário reflete no
 *  thread antes de salvar, como o resto do editor já faz. */
export function threadCommentsOf(
  conversation: { ready: boolean; items: readonly ConversationItem[] },
  card: TaskRecord | null,
  tasks: readonly TaskRecord[],
  draftKind: string,
): ThreadComment[] {
  if (conversation.ready) return conversation.items.flatMap((item) => {
    if (item.kind === "file") return [];
    return [{
      taskId: item.taskId, author: item.author ?? "Sistema", author_id: item.authorId ?? undefined,
      text: item.kind !== "event" ? item.text ?? ""
        : item.text && DECISION_EVENTS.has(item.eventType ?? "") ? `${activityLabel(item.eventType)} — ${item.text}`
          : item.text ?? activityLabel(item.eventType),
      at: item.at, edited_at: item.editedAt, asset_ids: item.assetIds, timelineKind: item.kind,
      taskTitle: item.taskTitle, path: item.path, meetingDate: item.meetingDate,
    }];
  });
  return card ? familyThreadOf(card, [...tasks], draftKind) : [];
}

export default function TaskCommentThread({
  comments, openCard, cardsById, currentUserId, tone, assets, docsReady,
  onOpenLink, isKnownDoc, onOpenAsset, onPatched, onError,
}: {
  comments: readonly ThreadComment[];
  openCard: TaskRecord;
  /** Todos os cards do cliente + o aberto: origem de cada comentário da família. */
  cardsById: ReadonlyMap<string, TaskRecord>;
  currentUserId: string | null;
  tone: string;
  assets: ReadonlyMap<string, CommentAsset>;
  docsReady: boolean;
  onOpenLink: (url: string) => boolean;
  isKnownDoc: (url: string) => boolean;
  onOpenAsset: (creativeTaskId: string, assetId: string) => void;
  onPatched: (updated: TaskRecord) => void;
  onError: (message: string) => void;
}) {
  // Comentário em edição inline. Guarda o `at` que estava na tela para o
  // servidor recusar se a thread mudou (ver edit_task_comment).
  // `taskId`: o card onde o comentário está gravado — pode ser uma etapa ou
  // outro card da família, não só o card aberto.
  const [editing, setEditing] = useState<{ taskId: string; index: number; at: string; text: string } | null>(null);
  const ownComments = commentsOf(openCard);

  async function saveEdit() {
    if (!editing) return;
    const { taskId, index, at, text } = editing;
    if (!text.trim()) return;
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}/comments`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, at, text: text.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      setEditing(null);
      onPatched(await res.json() as TaskRecord);
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : "Não foi possível editar o comentário.");
    }
  }

  async function remove(taskId: string, index: number, at: string) {
    if (!window.confirm("Excluir este comentário? Não dá para desfazer.")) return;
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}/comments`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, at }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      if (editing?.taskId === taskId && editing.index === index) setEditing(null);
      onPatched(await res.json() as TaskRecord);
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : "Não foi possível excluir o comentário.");
    }
  }

  return (
    <div className="tm-comments">
      {comments.slice().reverse().map((c, i) => {
        // A thread pode misturar comentários de vários cards da
        // família (plano + atividades, entrega + etapas). Os do
        // card aberto são editáveis; os gravados em outro card da
        // família, só por quem os escreveu (30/09 — na Entrega o
        // comentário cai na etapa, e o autor ficava sem como
        // apagar o próprio link). O índice que o servidor conhece
        // é o do `payload.comments` do card de ORIGEM, casado por
        // `at` + texto.
        const own = c.taskId === openCard.id;
        const originCard = own ? openCard : cardsById.get(c.taskId) ?? null;
        const mine = own || Boolean(c.author_id && c.author_id === currentUserId);
        const storedIndex = originCard && mine ? (own ? ownComments : commentsOf(originCard)).findIndex((o) => o.at === c.at && o.text === c.text) : -1;
        const isEditing = editing?.taskId === c.taskId && editing.index === storedIndex;
        // Papel de quem comentou NO CARD ONDE O COMENTÁRIO CAIU —
        // não no card aberto agora. Recalculado a cada render, a
        // partir do estado atual (nunca congelado no comentário).
        const originStep = cardsById.get(c.taskId) ?? null;
        const role = originStep && c.author_id
          ? stepRoleOf(originStep, new Set(originStep.assignee_profile_ids), c.author_id)
          : null;
        const roleLabel = role?.kind === "revisor" ? REVISOR_LABEL : role?.responsibility ? ROLE_LABEL[role.responsibility] : null;
        const roleClass = role?.kind === "revisor" ? "t-tone-neutral" : role?.responsibility ? roleTone(role.responsibility) : null;
        const destinationLabel = c.taskTitle && !own ? c.taskTitle : !own && originStep ? subtypeLabel(originStep.subtype) || originStep.title : null;
        return (
          <div className={`tm-comment${isEditing ? " editing" : ""}${c.timelineKind === "event" ? " is-event" : ""}`} key={`${c.taskId}-${c.at}-${i}`}>
            <CommentAvatar comment={c} className="tm-comment-av" />
            <div className="tm-comment-body">
              {/* <div>, não <p>: o menu "…" (CommentActionsMenu) é um <div>, e <div>
                  dentro de <p> é HTML inválido — no card aberto por link o navegador
                  fechava o <p> antes do menu e o React descartava o HTML do servidor
                  (erro de hidratação, 25/09). O CSS usa só a classe. */}
              <div className="tm-comment-meta">
                <b>{c.author}</b>
                {c.timelineKind === "event" ? <span className="tm-activity-kind">Atividade</span> : null}
                {roleLabel ? <span className={`kb-type ${roleClass}`}>{roleLabel}</span> : null}
                {destinationLabel ? <small className="tm-comment-origin" title={c.path?.join(" → ") ?? "Onde este comentário foi gravado"}>→ {destinationLabel}</small> : null}
                {c.meetingDate ? <small className="tm-comment-origin">Reunião · {formatShortDate(c.meetingDate)}</small> : null}
                <small>{formatCommentTime(c.at)}</small>
                {c.edited_at ? <small className="tm-comment-edited">editado</small> : null}
                {storedIndex >= 0 ? (
                  <CommentActionsMenu
                    onEdit={() => setEditing({ taskId: c.taskId, index: storedIndex, at: c.at, text: c.text })}
                    onDelete={() => void remove(c.taskId, storedIndex, c.at)}
                  />
                ) : null}
              </div>
              {isEditing ? (
                <div className="tm-comment-edit">
                  <AutoGrowTextarea
                    rows={1}
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <div className="tm-comment-edit-actions">
                    <button type="button" className="admin-btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    <button type="button" className={`admin-btn primary tm-btn-${tone}`} onClick={() => void saveEdit()} disabled={!editing.text.trim()}>Salvar</button>
                  </div>
                </div>
              ) : (
                <p className="tm-comment-text"><CommentText text={c.text} onLinkClick={onOpenLink} showLinkPreview={docsReady} hidePreviewForUrl={isKnownDoc} /></p>
              )}
              {c.asset_ids?.length ? <div className="tm-comment-assets">{c.asset_ids.map((id) => {
                const found = assets.get(id);
                if (!found || found.asset.state === "trashed") return null;
                return <button type="button" key={id} className="tm-comment-asset" title={found.asset.name} onClick={() => onOpenAsset(found.workspace.creative_task_id, id)}>
                  <span className="tm-comment-asset-image">{found.asset.mime_type.startsWith("image/") ? <img src={`/api/admin/drive/thumbnail/${found.asset.drive_file_id}`} alt="" loading="lazy" /> : "▣"}</span>
                  <span>{found.asset.name}</span>
                </button>;
              })}</div> : null}
            </div>
          </div>
        );
      })}
      {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
    </div>
  );
}
