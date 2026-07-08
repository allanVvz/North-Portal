"use client";

import { useState } from "react";
import CalendarPicker from "./CalendarPicker";
import { ATTR_DEFS, KIND_ICON, isAttrVisible, useAttrVisibility } from "./kanbanAttrs";
import {
  COLUMNS, FORMATO_OPTIONS, PLATAFORMA_OPTIONS, PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER,
  TONES, commentsOf, initials, relTime,
} from "./kanbanShared";
import { TASK_KIND_KEYS, kindDef, kindIcon, kindLabel, kindTone, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import type { ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";

type Draft = {
  title: string;
  kind: string;
  subtype: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string;
  reviewer_id: string;
  approver_id: string;
  plan_id: string;
  due_date: string;
  start_date: string;
  end_date: string;
  hora: string;
  description: string;
  client_visible: boolean;
  statusLabel: string;
  statusTone: string;
  barTone: string;
  formato: string;
  plataforma: string;
  legenda: string;
};

function draftFrom(task: TaskRecord | null, initialStatus?: TaskStatus): Draft {
  const p = (task?.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return {
    title: task?.title ?? "",
    kind: task?.kind ?? "criativo",
    subtype: task?.subtype ?? "",
    status: task?.status ?? initialStatus ?? "backlog",
    priority: task?.priority ?? "media",
    assignee: task?.assignee ?? "",
    reviewer_id: task?.reviewer_id ?? "",
    approver_id: task?.approver_id ?? "",
    plan_id: task?.plan_id ?? "",
    due_date: task?.due_date ?? "",
    start_date: task?.start_date ?? "",
    end_date: task?.end_date ?? "",
    hora: str("hora"),
    description: task?.description ?? "",
    client_visible: task?.client_visible ?? false,
    statusLabel: str("statusLabel"),
    statusTone: str("statusTone") || "green",
    barTone: str("barTone") || "green",
    formato: str("formato"),
    plataforma: str("plataforma"),
    legenda: str("legenda"),
  };
}

function Cell({ icon, label, hidden, children }: { icon: string; label: string; hidden?: boolean; children: React.ReactNode }) {
  if (hidden) return null;
  return (
    <div className="tm-cell">
      <span className="tm-cell-ico" aria-hidden>{icon}</span>
      <div className="tm-cell-body">
        <span className="tm-cell-label">{label}</span>
        {children}
      </div>
    </div>
  );
}

export default function TaskModal({
  mode,
  task,
  slug,
  clientName,
  initialStatus,
  adminReviewers,
  clientReviewers,
  planCandidates = [],
  clientTasks = [],
  onTaskPatched,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "new" | "edit";
  task: TaskRecord | null;
  slug: string;
  clientName: string;
  initialStatus?: TaskStatus;
  adminReviewers: ReviewerCandidate[];
  clientReviewers: ReviewerCandidate[];
  planCandidates?: { id: string; title: string }[];
  clientTasks?: TaskRecord[];
  onTaskPatched?: (task: TaskRecord) => void;
  onClose: () => void;
  onSaved: (task: TaskRecord, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, initialStatus));
  const [liveTask, setLiveTask] = useState<TaskRecord | null>(task);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attrCfgOpen, setAttrCfgOpen] = useState(false);
  const { visible, map: attrMap, save: saveAttrMap } = useAttrVisibility();

  const kd = kindDef(draft.kind);
  const tone = kindTone(draft.kind);
  const subtypes = kd.subtypes ?? [];
  const attrsForKind = ATTR_DEFS.filter((a) => a.kinds === "base" || (a.kinds as string[]).includes(draft.kind));
  // Revisor is always an admin (internal Revisão); Aprovador is always a client
  // (Aprovação). "Sem revisor" / "Sem aprovação" skip that stage. Progress is a
  // rollup shown only for plans — regular cards derive it from their workflow
  // status silently, so it isn't a per-card attribute.

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const comments = liveTask ? commentsOf(liveTask) : [];

  function pickKind(kind: string) {
    setDraft((d) => {
      const def = kindDef(kind);
      return {
        ...d,
        kind,
        subtype: "", // reset — subtype vocabulary is per-kind
        // A plan can't belong to another plan.
        plan_id: def.isPlan ? "" : d.plan_id,
      };
    });
  }

  // Plan ↔ activity linking (for plano_acao cards): members are tasks whose
  // plan_id points here; candidates are the client's still-unlinked non-plan
  // tasks. Linking/unlinking just PATCHes the activity's plan_id.
  const planMembers = liveTask ? clientTasks.filter((t) => t.plan_id === liveTask.id) : [];
  const planPct = kd.isPlan && liveTask ? taskProgress(liveTask, planMembers) : 0;
  const linkableCandidates = liveTask
    ? clientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.plan_id && t.client_id === liveTask.client_id)
    : [];
  async function linkMember(taskId: string, planId: string | null) {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (res.ok) onTaskPatched?.(await res.json());
    } catch { /* leave as-is; user can retry */ }
  }

  async function sendComment() {
    if (!liveTask || !comment.trim()) return;
    const text = comment.trim();
    const next = [...comments, { author: "Admin North", text, at: new Date().toISOString() }];
    setComment("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { ...(liveTask.payload ?? {}), comments: next } }),
      });
      if (res.ok) setLiveTask(await res.json());
    } catch { /* comment stays unsent; user can retry */ }
  }

  async function save() {
    if (!draft.title.trim()) return;
    setBusy(true);
    setError("");
    const existingPayload = (liveTask?.payload ?? {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = { ...existingPayload };
    delete payload.pct; // progress is computed now, never persisted
    if (draft.statusLabel.trim()) payload.statusLabel = draft.statusLabel.trim(); else delete payload.statusLabel;
    payload.statusTone = draft.statusTone;
    payload.barTone = draft.barTone;
    const strOrDelete = (key: string, value: string) => { if (value.trim()) payload[key] = value.trim(); else delete payload[key]; };
    strOrDelete("formato", draft.formato);
    strOrDelete("plataforma", draft.plataforma);
    strOrDelete("hora", draft.hora);
    strOrDelete("legenda", draft.legenda);

    // Agendamento: fold date + time into a single timestamp for the calendar.
    const scheduled_start_at =
      draft.kind === "agendamento" && draft.due_date.trim() && draft.hora.trim()
        ? `${draft.due_date.trim()}T${draft.hora.trim()}:00`
        : null;

    const body: Record<string, unknown> = {
      title: draft.title.trim(),
      kind: draft.kind,
      subtype: draft.subtype || null,
      status: draft.status,
      priority: draft.priority,
      assignee: draft.assignee.trim() || null,
      reviewer_id: draft.reviewer_id || null,
      approver_id: draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      // requires_* are derived from the presence of a revisor/aprovador —
      // "Sem revisor"/"Sem aprovação" means that stage is skipped.
      requires_review: Boolean(draft.reviewer_id),
      requires_approval: Boolean(draft.approver_id),
      due_date: draft.due_date.trim() || null,
      start_date: kd.isPlan ? draft.start_date.trim() || null : null,
      end_date: kd.isPlan ? draft.end_date.trim() || null : null,
      scheduled_start_at,
      description: draft.description.trim() || null,
      client_visible: draft.client_visible,
      payload,
    };
    try {
      const res = liveTask
        ? await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, slug }) });
      if (!res.ok) throw new Error();
      onSaved(await res.json(), !liveTask);
    } catch {
      setError("Não foi possível salvar a tarefa.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!liveTask) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "DELETE" });
      onDeleted(liveTask.id);
    } catch { setError("Não foi possível excluir."); }
    setBusy(false);
  }

  const stepIdx = STATUS_ORDER.indexOf(draft.status);

  return (
    <div className="kb-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className={`tm tm-tone-${tone}`} onClick={(e) => e.stopPropagation()}>
        {mode === "edit" ? (
          <div className={`tm-head tm-head-tone-${tone}`}>
            <span className="tm-head-ico" aria-hidden>{kindIcon(draft.kind)}</span>
            <div className="tm-head-text">
              <input
                className="tm-title-input"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Título da tarefa"
              />
              <span className="tm-head-client">{clientName} · {kindLabel(draft.kind)}{draft.subtype ? ` · ${subtypeLabel(draft.subtype)}` : ""}</span>
            </div>
            <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
          </div>
        ) : (
          <div className="tm-head tm-head-plain">
            <div>
              <h2>Nova Tarefa</h2>
              <p className="admin-sub">Escolha o tipo de card e preencha as seções essenciais.</p>
            </div>
            <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
          </div>
        )}

        {mode === "new" ? (
          <div className="tm-typepicker">
            {TASK_KIND_KEYS.map((k) => (
              <button
                type="button"
                key={k}
                className={`tm-typecard tm-typecard-tone-${kindTone(k)} ${draft.kind === k ? "on" : ""}`}
                onClick={() => pickKind(k)}
              >
                <span className="tm-typecard-top">
                  <span className="tm-typecard-ico" aria-hidden>{kindIcon(k)}</span>
                  <strong>{kindLabel(k)}</strong>
                  <span className="tm-typecard-radio" aria-hidden />
                </span>
                <p>{kindDef(k).blurb}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="tm-stepper">
            {COLUMNS.map((c, i) => (
              <button
                type="button"
                key={c.status}
                className={`tm-step ${i <= stepIdx ? "done" : ""} ${draft.status === c.status ? "current" : ""}`}
                onClick={() => set("status", c.status)}
              >
                <span className="tm-step-dot" />
                <span className="tm-step-label">{c.label}</span>
                {i < COLUMNS.length - 1 ? <span className="tm-step-line" /> : null}
              </button>
            ))}
          </div>
        )}

        {mode === "new" ? (
          <div className="tm-box">
            <p className="tm-box-label">Detalhes do card</p>
            <input
              className="tm-newtitle"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Título da tarefa"
            />
            <span className="tm-newclient">{clientName}</span>
          </div>
        ) : null}

        <div className="tm-grid">
          {/* Tipo & subtipo */}
          {mode === "edit" ? (
            <Cell icon={kindIcon(draft.kind)} label="Tipo">
              <select value={draft.kind} onChange={(e) => pickKind(e.target.value)}>
                {TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </Cell>
          ) : null}
          {subtypes.length ? (
            <Cell icon="◧" label="Subtipo">
              <select value={draft.subtype} onChange={(e) => set("subtype", e.target.value)}>
                <option value="">—</option>
                {subtypes.map((s) => <option key={s} value={s}>{subtypeLabel(s)}</option>)}
              </select>
            </Cell>
          ) : null}

          {/* Vínculo com plano (não para o próprio plano) */}
          {!kd.isPlan ? (
            <Cell icon="◆" label="Plano de Ação">
              <select value={draft.plan_id} onChange={(e) => set("plan_id", e.target.value)}>
                <option value="">— Sem plano —</option>
                {planCandidates
                  .filter((p) => p.id !== liveTask?.id)
                  .map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Cell>
          ) : null}

          {/* Datas */}
          {kd.isPlan ? (
            <>
              <Cell icon="▦" label="Início">
                <CalendarPicker value={draft.start_date} onChange={(v) => set("start_date", v)} placeholder="—" />
              </Cell>
              <Cell icon="▦" label="Fim">
                <CalendarPicker value={draft.end_date} onChange={(v) => set("end_date", v)} placeholder="—" />
              </Cell>
            </>
          ) : draft.kind === "agendamento" ? (
            <Cell icon="▦" label="Data/hora">
              <div className="tm-cell-inline">
                <CalendarPicker value={draft.due_date} onChange={(v) => set("due_date", v)} placeholder="—" />
                <input type="time" value={draft.hora} onChange={(e) => set("hora", e.target.value)} />
              </div>
            </Cell>
          ) : (
            <Cell icon="▦" label="Prazo">
              <CalendarPicker value={draft.due_date} onChange={(v) => set("due_date", v)} placeholder="—" />
            </Cell>
          )}

          {/* Atributos por kind */}
          {draft.kind === "criativo" ? (
            <Cell icon="◧" label="Formato" hidden={!visible("formato")}>
              <select value={draft.formato} onChange={(e) => set("formato", e.target.value)}>
                <option value="">—</option>
                {FORMATO_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Cell>
          ) : null}
          {draft.kind === "criativo" || draft.kind === "agendamento" ? (
            <Cell icon="◔" label="Plataforma" hidden={!visible("plataforma")}>
              <select value={draft.plataforma} onChange={(e) => set("plataforma", e.target.value)}>
                <option value="">—</option>
                {PLATAFORMA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Cell>
          ) : null}
          {draft.kind === "agendamento" ? (
            <Cell icon="#" label="Legenda" hidden={!visible("legenda")}>
              <input value={draft.legenda} onChange={(e) => set("legenda", e.target.value)} placeholder="Pronta para revisão" />
            </Cell>
          ) : null}

          {/* Revisor (admin, etapa de Revisão) — "Sem revisor" pula a etapa */}
          <Cell icon="✓" label="Revisor">
            <select value={draft.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
              <option value="">— Sem revisor —</option>
              {adminReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Cell>

          {/* Aprovador (cliente, etapa de Aprovação) — "Sem aprovação" pula a etapa */}
          <Cell icon="✓" label="Aprovador">
            <select value={draft.approver_id} onChange={(e) => set("approver_id", e.target.value)}>
              <option value="">— Sem aprovação —</option>
              {clientReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Cell>

          {/* Responsável */}
          <Cell icon="◔" label="Responsável" hidden={!visible("assignee")}>
            <input value={draft.assignee} onChange={(e) => set("assignee", e.target.value)} placeholder="Nome" />
          </Cell>

          <Cell icon="⚑" label="Status">
            <span className="tm-cell-static">{STATUS_LABEL[draft.status]}</span>
          </Cell>
          <Cell icon="⚑" label="Prioridade">
            <select value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Cell>

          {/* Progresso — só existe para planos de ação (média das tarefas) */}
          {kd.isPlan ? (
            <Cell icon="◑" label="Progresso">
              <span className="tm-cell-static">Média das tarefas · {planPct}%</span>
            </Cell>
          ) : null}
        </div>

        {kd.isPlan && liveTask ? (
          <div className="tm-box tm-planmembers">
            <p className="tm-box-label">Atividades do plano ({planMembers.length})</p>
            <div className="tm-member-list">
              {planMembers.map((m) => (
                <div className="tm-member" key={m.id}>
                  <span className={`kb-type t-tone-${kindTone(m.kind)}`}>{kindLabel(m.kind)}</span>
                  <span className="tm-member-title">{m.title}</span>
                  <span className="tm-member-status">{STATUS_LABEL[m.status]}</span>
                  <button className="tm-member-unlink" title="Desvincular do plano" onClick={() => linkMember(m.id, null)}>✕</button>
                </div>
              ))}
              {planMembers.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhuma atividade vinculada ainda.</p> : null}
            </div>
            {linkableCandidates.length ? (
              <select
                className="tm-member-add"
                value=""
                onChange={(e) => { if (e.target.value) void linkMember(e.target.value, liveTask.id); }}
              >
                <option value="">+ Vincular atividade existente…</option>
                {linkableCandidates.map((t) => <option key={t.id} value={t.id}>{kindLabel(t.kind)} · {t.title}</option>)}
              </select>
            ) : null}
          </div>
        ) : null}

        {mode === "edit" ? (
          <div className="tm-box tm-attrsbox">
            <button type="button" className="tm-attrs-toggle" onClick={() => setAttrCfgOpen((o) => !o)}>
              ⚙ Atributos visíveis <span className={`tm-attrs-caret ${attrCfgOpen ? "on" : ""}`}>⌄</span>
            </button>
            {attrCfgOpen ? (
              <div className="attrcfg-list tm-attrcfg-list">
                {attrsForKind.map((a) => (
                  <div className="attrcfg-row" key={a.key}>
                    <span className="attrcfg-ico" aria-hidden>{KIND_ICON[a.kind]}</span>
                    <span className="attrcfg-meta">
                      <strong>{a.label}</strong>
                      <small>{a.scope}</small>
                    </span>
                    <label className="admin-toggle attrcfg-toggle" title={a.locked ? "Sempre visível" : undefined}>
                      <input
                        type="checkbox"
                        checked={isAttrVisible(attrMap, a.key)}
                        disabled={a.locked}
                        onChange={() => saveAttrMap({ ...attrMap, [a.key]: attrMap[a.key] === false ? true : false })}
                      />
                      <span className="sw" />
                    </label>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "new" ? (
          <div className="tm-box">
            <p className="tm-box-label">Descrição inicial</p>
            <textarea
              className="tm-desc-input"
              rows={2}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Objetivo, referência e critério de pronto entram aqui antes de enviar para o quadro."
            />
          </div>
        ) : (
          <>
            <div className="tm-box">
              <p className="tm-box-label">Descrição do card</p>
              <textarea
                className="tm-desc-input"
                rows={3}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Objetivo, referência e critério de pronto entram aqui antes de enviar para o quadro."
              />
            </div>
            <div className="tm-box tm-commentsbox">
              <p className="tm-box-label">Comentários e atividade</p>
              <div className="tm-comments">
                {comments.slice().reverse().map((c, i) => (
                  <div className="tm-comment" key={i}>
                    <span className="tm-comment-av">{initials(c.author)}</span>
                    <div>
                      <p className="tm-comment-meta"><b>{c.author}</b><small>{relTime(c.at)}</small></p>
                      <p className="tm-comment-text">{c.text}</p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
              </div>
              <div className="tm-comment-input">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void sendComment(); }}
                  placeholder="Escrever comentário…"
                />
                <button className={`admin-btn primary tm-btn-${tone}`} onClick={sendComment} disabled={!comment.trim()}>Enviar</button>
              </div>
            </div>
          </>
        )}

        <label className="admin-toggle tm-visible-toggle">
          <input type="checkbox" checked={draft.client_visible} onChange={(e) => set("client_visible", e.target.checked)} />
          <span className="sw" />
          <span>{kd.isPlan ? "Plano visível para o cliente" : "Visível no Plano de Ação do cliente"}</span>
        </label>

        {draft.client_visible ? (
          <fieldset className="kb-visible-fields">
            <legend>Como aparece para o cliente</legend>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Rótulo de status</span>
                <input value={draft.statusLabel} onChange={(e) => set("statusLabel", e.target.value)} placeholder="Em andamento" />
              </label>
              <label className="admin-field"><span>Cor do status</span>
                <select value={draft.statusTone} onChange={(e) => set("statusTone", e.target.value)}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <div className="kb-modal-row">
              <label className="admin-field"><span>Cor da barra</span>
                <select value={draft.barTone} onChange={(e) => set("barTone", e.target.value)}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <p className="admin-sub tm-progress-hint">
                {kd.isPlan
                  ? "O progresso do plano é a média das tarefas vinculadas."
                  : "O progresso segue automaticamente a etapa do Kanban."}
              </p>
            </div>
          </fieldset>
        ) : null}

        {error ? <p className="admin-error">{error}</p> : null}

        <div className="kb-modal-actions">
          {liveTask ? <button className="admin-btn ghost danger" onClick={remove} disabled={busy}>Excluir</button> : <span />}
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className={`admin-btn primary tm-btn-${tone}`} onClick={save} disabled={busy || !draft.title.trim()}>
              {busy ? "Salvando…" : mode === "new" ? "Criar card" : "Salvar card"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
