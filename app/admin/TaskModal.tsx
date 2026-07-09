"use client";

import { useEffect, useRef, useState } from "react";
import AttrVisibilityPopover from "./AttrVisibilityPopover";
import CalendarPicker from "./CalendarPicker";
import VisibleToggleField from "./VisibleToggleField";
import { ATTR_DEFS, useAttrVisibility } from "./kanbanAttrs";
import {
  COLUMNS, FORMATO_OPTIONS, PLATAFORMA_OPTIONS, PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER,
  TONES, commentsOf, initials, relTime,
} from "./kanbanShared";
import { TASK_KIND_KEYS, kindDef, kindIcon, kindLabel, kindTone, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";

// The "new task" picker only offers these 4 — the other kinds in the catalog
// (planejamento, roteiro, gravacao, checkpoint_comercial) still exist and are
// reachable via the Tipo select once a card is created/edited.
const NEW_TASK_KINDS = ["plano_acao", "criativo", "agendamento", "operacional"];

type Draft = {
  title: string;
  kind: string;
  clientSlug: string;
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
};

function draftFrom(task: TaskRecord | null, initialStatus: TaskStatus | undefined, initialSlug: string, initialAssignee?: string): Draft {
  const p = (task?.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return {
    title: task?.title ?? "",
    kind: task?.kind ?? "criativo",
    clientSlug: initialSlug,
    subtype: task?.subtype ?? "",
    status: task?.status ?? initialStatus ?? "backlog",
    priority: task?.priority ?? "media",
    assignee: task?.assignee ?? initialAssignee ?? "",
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

// Small styled dropdown replacing the old 8-card grid — only the 4 curated
// kinds are offered when creating a task.
function TypeSelect({ kind, onPick }: { kind: string; onPick: (kind: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="tm-typeselect" ref={ref}>
      <p className="tm-typeselect-label">Tipo de tarefa</p>
      <button
        type="button"
        className={`tm-typeselect-trigger tm-typecard-tone-${kindTone(kind)}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="tm-typeselect-ico" aria-hidden>{kindIcon(kind)}</span>
        <span className="tm-typeselect-text">
          <strong>{kindLabel(kind)}</strong>
          <small>{kindDef(kind).blurb}</small>
        </span>
        <span className={`tm-typeselect-caret ${open ? "on" : ""}`} aria-hidden>⌄</span>
      </button>
      {open ? (
        <div className="tm-typeselect-panel" role="listbox">
          {NEW_TASK_KINDS.map((k) => (
            <button
              type="button"
              key={k}
              role="option"
              aria-selected={kind === k}
              className={`tm-typeselect-option tm-typecard-tone-${kindTone(k)} ${kind === k ? "on" : ""}`}
              onClick={() => { onPick(k); setOpen(false); }}
            >
              <span className="tm-typeselect-ico" aria-hidden>{kindIcon(k)}</span>
              <span className="tm-typeselect-text">
                <strong>{kindLabel(k)}</strong>
                <small>{kindDef(k).blurb}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TaskModal({
  mode,
  task,
  slug,
  clients,
  clientName,
  initialStatus,
  initialAssignee,
  adminReviewers,
  clientReviewers,
  planCandidates = [],
  clientTasks = [],
  planoVisibilityOn = true,
  flowFlags = null,
  onTaskPatched,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "new" | "edit";
  task: TaskRecord | null;
  slug: string;
  clients: { slug: string; name: string }[];
  clientName: string;
  initialStatus?: TaskStatus;
  initialAssignee?: string;
  adminReviewers: ReviewerCandidate[];
  clientReviewers: ReviewerCandidate[];
  planCandidates?: { id: string; title: string }[];
  clientTasks?: TaskRecord[];
  planoVisibilityOn?: boolean;
  flowFlags?: ClientFlowFlags | null;
  onTaskPatched?: (task: TaskRecord) => void;
  onClose: () => void;
  onSaved: (task: TaskRecord, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, initialStatus, slug, initialAssignee));
  const [liveTask, setLiveTask] = useState<TaskRecord | null>(task);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // lazy: this modal only ever mounts client-side after a click — reading
  // localStorage synchronously here (vs. starting empty + syncing in an
  // effect) is what stops attributes from flashing visible then disappearing
  // right after the card opens.
  const { visible } = useAttrVisibility({ lazy: true });

  const kd = kindDef(draft.kind);
  const tone = kindTone(draft.kind);
  const subtypes = kd.subtypes ?? [];
  // In "new" mode the Cliente attribute can change the target client, so the
  // header label tracks the draft instead of the (possibly stale) prop.
  const draftClientName = mode === "new"
    ? (clients.find((c) => c.slug === draft.clientSlug)?.name ?? "Sem cliente")
    : clientName;
  const attrsForKind = ATTR_DEFS.filter((a) => a.kinds === "base" || (a.kinds as string[]).includes(draft.kind));
  // A client with Revisão/Aprovação admin-disabled never has that stage —
  // hide the field and force "sem revisor"/"sem aprovador" on save. While
  // flowFlags hasn't loaded yet (null), default to OFF/hidden rather than
  // shown — otherwise the field flashes visible for the fetch's duration
  // before disappearing once the real (usually off) value arrives.
  const revisaoOff = flowFlags ? !flowFlags.revisaoAdmin : true;
  const aprovacaoOff = flowFlags ? !flowFlags.aprovacaoAdmin : true;
  // Manual override: even with the flow off for this client, the admin can
  // reveal Revisor/Aprovador via the attributes popover — shown read-only
  // ("apenas visual") since assigning here wouldn't actually drive a stage
  // that's disabled for this client.
  const revisaoVisual = revisaoOff && visible("reviewer");
  const aprovacaoVisual = aprovacaoOff && visible("approver");
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
      reviewer_id: revisaoOff ? null : draft.reviewer_id || null,
      approver_id: aprovacaoOff ? null : draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      // requires_* are derived from the presence of a revisor/aprovador —
      // "Sem revisor"/"Sem aprovação" means that stage is skipped. A client
      // with the flow admin-disabled never requires it, regardless of draft.
      requires_review: revisaoOff ? false : Boolean(draft.reviewer_id),
      requires_approval: aprovacaoOff ? false : Boolean(draft.approver_id),
      due_date: draft.due_date.trim() || null,
      start_date: kd.isPlan ? draft.start_date.trim() || null : null,
      end_date: kd.isPlan ? draft.end_date.trim() || null : null,
      scheduled_start_at,
      description: draft.description.trim() || null,
      client_visible: planoVisibilityOn ? draft.client_visible : false,
      payload,
    };
    try {
      const res = liveTask
        ? await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/tasks`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            // Omit slug entirely for "sem cliente" — the schema treats an empty
            // string as an invalid slug, not as "no client".
            body: JSON.stringify(draft.clientSlug ? { ...body, slug: draft.clientSlug } : body),
          });
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
      <div className={`tm tm-tone-${tone} tm-lg`} onClick={(e) => e.stopPropagation()}>
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
            <div className="tm-head-actions">
              <AttrVisibilityPopover attrs={attrsForKind} />
              <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
            </div>
          </div>
        ) : (
          <div className="tm-head tm-head-plain">
            <div>
              <h2>Nova Tarefa</h2>
              <p className="admin-sub">Conte o essencial e escolha o tipo do card.</p>
            </div>
            <button className="kb-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
          </div>
        )}

        <div className="tm-layout">
          <div className="tm-main">
            {mode === "new" ? (
              <div className="tm-box tm-titlebox">
                <input
                  className="tm-newtitle tm-newtitle-lg"
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Título da tarefa"
                />
                <span className="tm-newclient">{draftClientName}</span>
                <textarea
                  className="tm-desc-input"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Objetivo, referência e critério de pronto."
                />
              </div>
            ) : null}

            {mode === "new" ? (
              <TypeSelect kind={draft.kind} onPick={pickKind} />
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

            <div className="tm-grid">
              {/* Cliente — só no modo novo; pode ficar "Sem cliente" (cai no filtro "Outros") */}
              {mode === "new" ? (
                <Cell icon="◔" label="Cliente">
                  <select value={draft.clientSlug} onChange={(e) => set("clientSlug", e.target.value)}>
                    <option value="">— Sem cliente —</option>
                    {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                </Cell>
              ) : null}
              {/* Tipo & subtipo */}
              {mode === "edit" ? (
                <Cell icon={kindIcon(draft.kind)} label="Tipo">
                  <select value={draft.kind} onChange={(e) => pickKind(e.target.value)}>
                    {TASK_KIND_KEYS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                  </select>
                </Cell>
              ) : null}
              {subtypes.length ? (
                <Cell icon="◧" label="Subtipo" hidden={!visible("subtype")}>
                  <select value={draft.subtype} onChange={(e) => set("subtype", e.target.value)}>
                    <option value="">—</option>
                    {subtypes.map((s) => <option key={s} value={s}>{subtypeLabel(s)}</option>)}
                  </select>
                </Cell>
              ) : null}

              {/* Vínculo com plano (não para o próprio plano) */}
              {!kd.isPlan ? (
                <Cell icon="◆" label="Plano de Ação" hidden={!visible("plan_link")}>
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

              {/* Revisor (admin, etapa de Revisão) — "Sem revisor" pula a etapa. Se o
                  fluxo está desligado pro cliente mas o override do popover está
                  ligado, mostra só leitura (atribuir aqui não ativaria a etapa). */}
              {revisaoVisual ? (
                <Cell icon="✓" label="Revisor">
                  <span className="tm-cell-static">
                    {draft.reviewer_id ? (adminReviewers.find((r) => r.id === draft.reviewer_id)?.label ?? "—") : "— Sem revisor —"}
                  </span>
                </Cell>
              ) : (
                <Cell icon="✓" label="Revisor" hidden={revisaoOff}>
                  <select value={draft.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
                    <option value="">— Sem revisor —</option>
                    {adminReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </Cell>
              )}

              {/* Aprovador (cliente, etapa de Aprovação) — mesma lógica do Revisor. */}
              {aprovacaoVisual ? (
                <Cell icon="✓" label="Aprovador">
                  <span className="tm-cell-static">
                    {draft.approver_id ? (clientReviewers.find((r) => r.id === draft.approver_id)?.label ?? "—") : "— Sem aprovação —"}
                  </span>
                </Cell>
              ) : (
                <Cell icon="✓" label="Aprovador" hidden={aprovacaoOff}>
                  <select value={draft.approver_id} onChange={(e) => set("approver_id", e.target.value)}>
                    <option value="">— Sem aprovação —</option>
                    {clientReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </Cell>
              )}

              {/* Responsável */}
              <Cell icon="◔" label="Responsável" hidden={!visible("assignee")}>
                <input value={draft.assignee} onChange={(e) => set("assignee", e.target.value)} placeholder="Nome" />
              </Cell>

              <Cell icon="⚑" label="Status" hidden={!visible("status")}>
                <span className="tm-cell-static">{STATUS_LABEL[draft.status]}</span>
              </Cell>
              <Cell icon="⚑" label="Prioridade" hidden={!visible("priority")}>
                <select value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Cell>

              {/* Progresso — só existe para planos de ação (média das tarefas) */}
              {kd.isPlan ? (
                <Cell icon="◑" label="Progresso" hidden={!visible("progress")}>
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

            {planoVisibilityOn ? (
              <div className="tm-box tm-visibility-box">
                <VisibleToggleField
                  label={kd.isPlan ? "Plano visível para o cliente" : "Visível no Plano de Ação do cliente"}
                  checked={draft.client_visible}
                  onChange={(v) => set("client_visible", v)}
                />
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
              </div>
            ) : null}

            {mode === "edit" ? (
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

          {mode === "edit" ? (
            <div className="tm-side">
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
