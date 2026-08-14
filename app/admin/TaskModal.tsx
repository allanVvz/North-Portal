"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AttrVisibilityPopover from "./AttrVisibilityPopover";
import CalendarPicker, { type CalendarRecurrence } from "./CalendarPicker";
import AssigneePicker from "./AssigneePicker";
import TaskKindIcon from "./TaskKindIcon";
import VisibleToggleField from "./VisibleToggleField";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";
import { ATTR_DEFS, useAttrVisibility } from "./kanbanAttrs";
import {
  COLUMNS, FORMATO_OPTIONS, PLATAFORMA_OPTIONS, PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER,
  TONES, commentsOf, initials,
} from "./kanbanShared";
import CommentText from "@/app/CommentText";
import { useCurrentAdminUser } from "./CurrentUserContext";
import { formatCommentTime } from "@/lib/comments";
import { TASK_KIND_KEYS, canonicalTaskClassification, kindDef, kindIcon, kindLabel, kindTone, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import { actionPlanIdOf, actionPlanMembersOf, activatedTaskPayload, isDeferredTask, recurrenceExecutionsOf, recurrenceParentIdOf, recurrenceParentOf } from "@/lib/taskRelations";
import { recurrenceCycleOf, recurrenceRevisionOf } from "@/lib/recurrenceState";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { useTaskAutosave } from "./useTaskAutosave";

type Draft = {
  title: string;
  kind: string;
  clientSlug: string;
  subtype: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string;
  assignee_profile_ids: string[];
  reviewer_id: string;
  approver_id: string;
  plan_id: string;
  due_date: string;
  recurrence_cadence: CalendarRecurrence["cadence"];
  recurrence_weekdays: number[];
  recurrence_day_of_month: number | null;
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

export type TaskCreationScope = "task" | "plan" | "routine";

type PendingMember =
  | { key: string; kind: "existing"; taskId: string; title: string }
  | { key: string; kind: "new"; title: string; assignee: string; due_date: string };

function draftFrom(
  task: TaskRecord | null,
  initialStatus: TaskStatus | undefined,
  initialSlug: string,
  initialAssignee?: string,
  initialKind?: string,
  initialRecurrence = false,
  creationScope = "task",
): Draft {
  const requestedKind = task?.kind ?? (creationScope === "plan" ? "plano_acao" : initialKind ?? "operacional");
  const scopedKind = !task && creationScope !== "plan" && requestedKind === "plano_acao" ? "operacional" : requestedKind;
  const classification = canonicalTaskClassification(scopedKind, task?.subtype);
  const p = (task?.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return {
    title: task?.title ?? "",
    kind: classification.kind,
    clientSlug: initialSlug,
    subtype: classification.subtype ?? "",
    status: task?.status ?? initialStatus ?? "backlog",
    priority: task?.priority ?? "media",
    assignee: task?.assignee ?? initialAssignee ?? "",
    assignee_profile_ids: task?.assignee_profile_ids ?? [],
    reviewer_id: task?.reviewer_id ?? "",
    approver_id: task?.approver_id ?? "",
    plan_id: task ? actionPlanIdOf(task) ?? "" : "",
    due_date: task?.due_date ?? "",
    recurrence_cadence: task?.recurrence_cadence ?? (creationScope === "routine" || initialRecurrence ? "semanal" : null),
    recurrence_weekdays: task?.recurrence_weekdays ?? [],
    recurrence_day_of_month: task?.recurrence_day_of_month ?? null,
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

function resizeTextarea(element: HTMLTextAreaElement | null): void {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

function AutoGrowTextarea({ onChange, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => resizeTextarea(ref.current), [props.value]);
  return <textarea {...props} ref={ref} onChange={(event) => { onChange?.(event); resizeTextarea(event.currentTarget); }} />;
}

// Small inline dropdown used in the edit-mode header for Cliente and Tipo —
// click the pill, pick from the list, it closes itself (the click on an
// option bubbles up to the panel's own onClick).
function HeadDropdown({
  trigger,
  children,
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
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
    <div className={`tm-headpick ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        className="tm-headpick-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {trigger}
        <span className={`tm-headpick-caret ${open ? "on" : ""}`} aria-hidden>⌄</span>
      </button>
      {open ? (
        <div className="tm-headpick-panel" role="listbox" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// Search-or-create field for plan activities — types filter existing
// unlinked candidates from the same client; no exact match reveals a small
// inline form (responsável + data) so a brand-new activity can be queued
// without leaving the plan modal.
function PlanMemberComposer({
  candidates,
  assignees,
  defaultAssignee,
  defaultDueDate,
  busy,
  onLinkExisting,
  onCreateNew,
}: {
  candidates: { id: string; title: string; kind: string }[];
  assignees: string[];
  defaultAssignee: string;
  defaultDueDate: string;
  busy: boolean;
  onLinkExisting: (candidate: { id: string; title: string }) => void;
  onCreateNew: (data: { title: string; assignee: string; due_date: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formAssignee, setFormAssignee] = useState(defaultAssignee);
  const [formDate, setFormDate] = useState(defaultDueDate);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = needle ? candidates.filter((c) => c.title.toLowerCase().includes(needle)).slice(0, 6) : [];
  const exact = needle ? candidates.some((c) => c.title.toLowerCase() === needle) : false;

  function startCreate() {
    setFormAssignee(defaultAssignee);
    setFormDate(defaultDueDate);
    setCreating(true);
    setOpen(false);
  }

  function submitCreate() {
    const title = query.trim();
    if (!title) return;
    onCreateNew({ title, assignee: formAssignee, due_date: formDate });
    setQuery("");
    setCreating(false);
  }

  if (creating) {
    return (
      <div className="tm-member-createform">
        <p className="tm-member-createform-title">Nova atividade: “{query.trim()}”</p>
        <div className="kb-modal-row">
          <label className="admin-field"><span>Responsável</span>
            <select value={formAssignee} onChange={(e) => setFormAssignee(e.target.value)}>
              <option value="">— Sem responsável —</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="admin-field"><span>Data</span>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
          </label>
        </div>
        <div className="kb-modal-actions-right tm-member-createform-actions">
          <button type="button" className="admin-btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
          <button type="button" className="admin-btn primary" onClick={submitCreate} disabled={busy || !query.trim()}>+ Adicionar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tm-member-search" ref={ref}>
      <input
        className="tm-member-search-input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => query.trim() && setOpen(true)}
        placeholder="+ Buscar ou criar atividade…"
        disabled={busy}
      />
      {open && needle ? (
        <div className="tm-member-search-dropdown">
          {matches.map((c) => (
            <button type="button" key={c.id} className="tm-member-search-option" onClick={() => { onLinkExisting(c); setQuery(""); setOpen(false); }}>
              <TaskKindIcon kind={c.kind} size="sm" />
              <span>{c.title}</span>
            </button>
          ))}
          {!exact ? (
            <button type="button" className="tm-member-search-option tm-member-search-create" onClick={startCreate}>
              + Criar atividade “{query.trim()}”
            </button>
          ) : matches.length === 0 ? (
            <p className="tm-member-search-empty">Essa atividade já existe.</p>
          ) : null}
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
  assignees,
  clientName,
  initialStatus,
  initialAssignee,
  initialKind,
  initialRecurrence = false,
  creationScope = "task",
  adminReviewers,
  clientReviewers,
  planCandidates = [],
  clientTasks = [],
  planoVisibilityOn = false,
  flowFlags = null,
  onTaskPatched,
  onOpenRelatedTask,
  onBack,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "new" | "edit";
  task: TaskRecord | null;
  slug: string;
  clients: { slug: string; name: string }[];
  assignees: string[];
  clientName: string;
  initialStatus?: TaskStatus;
  initialAssignee?: string;
  initialKind?: string;
  initialRecurrence?: boolean;
  creationScope?: TaskCreationScope;
  adminReviewers: ReviewerCandidate[];
  clientReviewers: ReviewerCandidate[];
  planCandidates?: { id: string; title: string }[];
  clientTasks?: TaskRecord[];
  planoVisibilityOn?: boolean;
  flowFlags?: ClientFlowFlags | null;
  onTaskPatched?: (task: TaskRecord) => void;
  onOpenRelatedTask?: (task: TaskRecord) => void;
  onBack?: () => void;
  onClose: () => void;
  onSaved: (task: TaskRecord, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, initialStatus, slug, initialAssignee, initialKind, initialRecurrence, creationScope));
  const [liveTask, setLiveTask] = useState<TaskRecord | null>(task);
  // A recurrence template is a parent even if legacy data accidentally still
  // carries a child-only recurrence_parent_id. It must never render a second
  // "Card pai" box or try to fetch itself as a parent.
  const isRecurringParent = Boolean(liveTask?.recurrence_cadence || liveTask?.payload?.recurrence_group === true);
  const recurrenceParentId = liveTask && !isRecurringParent ? recurrenceParentIdOf(liveTask) : null;
  const [recurrenceParent, setRecurrenceParent] = useState<TaskRecord | null>(() => recurrenceParentOf(recurrenceParentId, clientTasks));
  const [comment, setComment] = useState("");
  const { name: currentUserName } = useCurrentAdminUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // lazy: this modal only ever mounts client-side after a click — reading
  // localStorage synchronously here (vs. starting empty + syncing in an
  // effect) is what stops attributes from flashing visible then disappearing
  // right after the card opens.
  const { visible } = useAttrVisibility({ lazy: true });

  const kd = kindDef(draft.kind);
  const tone = kindTone(draft.kind);
  const subtypes = kd.subtypes ?? [];
  const creationKinds = TASK_KIND_KEYS.filter((kind) => {
    if (mode === "edit") return kd.isPlan ? kind === "plano_acao" : kind !== "plano_acao";
    return creationScope === "plan" ? kind === "plano_acao" : kind !== "plano_acao";
  });
  // The Cliente attribute can change the target client in both modes now, so
  // the header label tracks the draft instead of the (possibly stale) prop.
  // Falls back to the prop for edit mode before `clients` has loaded.
  const draftClientName = draft.clientSlug
    ? (clients.find((c) => c.slug === draft.clientSlug)?.name ?? clientName ?? "Sem cliente")
    : (mode === "new" ? "Sem cliente" : clientName);
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

  // The stepper (progress bar below) must mirror the same gate: with the
  // stage off for this client, Revisão/Aprovação aren't a reachable option at
  // all — the ONLY way back in is the manual override above (attribute made
  // visible + an actual revisor/aprovador already assigned on THIS card).
  // A card already sitting in the gated stage still shows its own step, so
  // the current position never becomes literally invisible.
  const revisaoStepHidden = revisaoOff && !(revisaoVisual && draft.reviewer_id) && draft.status !== "revisao";
  const aprovacaoStepHidden = aprovacaoOff && !(aprovacaoVisual && draft.approver_id) && draft.status !== "aprovacao";
  // "Publicado" is Criativo-only (server enforces this too, see
  // PATCH /api/admin/tasks/[id]) — hide the step as an option for every
  // other kind, but never for a card already sitting there.
  const publicadoStepHidden = draft.kind !== "criativo" && draft.status !== "concluido";
  const progressColumns = COLUMNS.filter((column) => {
    if (column.status === "revisao") return !revisaoStepHidden;
    if (column.status === "aprovacao") return !aprovacaoStepHidden;
    if (column.status === "concluido") return !publicadoStepHidden;
    return true;
  });

  const autosaveValues = useMemo<Record<string, unknown>>(() => {
    const scheduledDate = (draft.start_date || draft.due_date).trim();
    return {
      title: draft.title.trim(), kind: draft.kind, subtype: draft.subtype || null,
      status: draft.status, priority: draft.priority, assignee: draft.assignee.trim() || null,
      assignee_profile_ids: draft.assignee_profile_ids,
      reviewer_id: revisaoOff ? null : draft.reviewer_id || null,
      approver_id: aprovacaoOff ? null : draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      requires_review: revisaoOff ? false : Boolean(draft.reviewer_id),
      requires_approval: aprovacaoOff ? false : Boolean(draft.approver_id),
      due_date: (liveTask?.recurrence_cadence ? liveTask.due_date : draft.start_date || draft.due_date)?.trim() || null,
      start_date: draft.start_date.trim() || draft.due_date.trim() || null,
      end_date: draft.end_date.trim() || null,
      scheduled_start_at: scheduledDate && draft.hora.trim() ? `${scheduledDate}T${draft.hora.trim()}:00` : null,
      recurrence_cadence: draft.recurrence_cadence,
      recurrence_weekdays: draft.recurrence_cadence ? draft.recurrence_weekdays : [],
      recurrence_day_of_month: draft.recurrence_cadence === "mensal" ? (draft.recurrence_day_of_month ?? 1) : null,
      description: draft.description.trim() || null,
      client_visible: planoVisibilityOn ? draft.client_visible : false,
      slug: draft.clientSlug || null,
      payload_patch: { statusLabel: draft.statusLabel.trim() || null, statusTone: draft.statusTone, barTone: draft.barTone, formato: draft.formato.trim() || null, plataforma: draft.plataforma.trim() || null, hora: draft.hora.trim() || null },
    };
  }, [aprovacaoOff, draft, kd.isPlan, liveTask?.due_date, liveTask?.recurrence_cadence, planoVisibilityOn, revisaoOff]);
  const acceptAutosave = useCallback((updated: TaskRecord) => {
    setLiveTask(updated);
    onTaskPatchedRef.current?.(updated);
  }, []);
  const autosave = useTaskAutosave({ taskId: liveTask?.id ?? "", values: autosaveValues, enabled: mode === "edit" && Boolean(liveTask), textKeys: ["title", "description"], valid: Boolean(draft.title.trim()), onSaved: acceptAutosave });

  async function closeAfterSave(action = onClose) {
    if (mode === "new") { action(); return; }
    if (!draft.title.trim()) { setError("Informe um título para fechar o card."); return; }
    if (await autosave.flush()) action();
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeAfterSave();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeAfterSave]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const comments = liveTask ? commentsOf(liveTask) : [];
  const onTaskPatchedRef = useRef(onTaskPatched);
  useEffect(() => { onTaskPatchedRef.current = onTaskPatched; }, [onTaskPatched]);

  useEffect(() => {
    if (!recurrenceParentId) { setRecurrenceParent(null); return; }
    const loaded = recurrenceParentOf(recurrenceParentId, clientTasks);
    if (loaded) { setRecurrenceParent(loaded); return; }
    let cancelled = false;
    fetch(`/api/admin/tasks/${encodeURIComponent(recurrenceParentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((parent: TaskRecord | null) => { if (!cancelled && parent) setRecurrenceParent(parent); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [recurrenceParentId, clientTasks]);

  function pickKind(kind: string) {
    if (mode === "new" && creationScope === "plan" && kind !== "plano_acao") return;
    if (mode === "new" && creationScope !== "plan" && kind === "plano_acao") return;
    setDraft((d) => {
      const def = kindDef(kind);
      return {
        ...d,
        kind,
        subtype: "", // reset — subtype vocabulary is per-kind
        // A plan can't belong to another plan.
        plan_id: def.isPlan ? "" : d.plan_id,
        recurrence_cadence: d.recurrence_cadence,
        recurrence_weekdays: d.recurrence_weekdays,
        recurrence_day_of_month: d.recurrence_day_of_month,
      };
    });
  }

  // Plan ↔ activity linking (for plano_acao cards): members are tasks whose
  // plan_id points here; candidates are the client's still-unlinked non-plan
  // tasks. Linking/unlinking just PATCHes the activity's plan_id.
  const planMembers = liveTask
    ? (isRecurringParent ? recurrenceExecutionsOf(liveTask.id, clientTasks) : actionPlanMembersOf(liveTask.id, clientTasks))
    : [];
  // Unsaved status changes are the task's current UI truth. Reading liveTask
  // here left the percentage frozen until Save, even while the stepper moved.
  const progressTask = liveTask ? { ...liveTask, kind: draft.kind, status: draft.status } : null;
  const headerPct = progressTask
    ? (kd.isPlan || isRecurringParent ? taskProgress(progressTask, planMembers) : taskProgress(progressTask))
    : 0;
  const linkableCandidates = liveTask
    ? clientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !actionPlanIdOf(t) && t.client_id === liveTask.client_id)
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

  async function unlinkMember(taskId: string, parentId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}/relations/${parentId}`, { method: "DELETE" });
      const body = await res.json().catch(() => null) as TaskRecord | { error?: string } | null;
      if (!res.ok) throw new Error(body && "error" in body ? body.error : "Não foi possível remover a ligação.");
      const updated = body as TaskRecord;
      if (liveTask?.id === updated.id) {
        setLiveTask(updated);
        setDraft(draftFrom(updated, initialStatus, slug, initialAssignee, initialKind, initialRecurrence, creationScope));
      }
      onTaskPatched?.(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover a ligação.");
    } finally {
      setBusy(false);
    }
  }

  // Same linking, but for a brand-new plan (mode="new", no id yet): activities
  // typed here are queued locally and only actually created/linked once the
  // plan itself is saved (see save()).
  const isNewPlan = mode === "new" && creationScope === "plan";
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [newPlanClientTasks, setNewPlanClientTasks] = useState<TaskRecord[]>([]);
  useEffect(() => {
    if (!isNewPlan || !draft.clientSlug) { setNewPlanClientTasks([]); return; }
    let cancelled = false;
    fetch(`/api/admin/tasks?slug=${encodeURIComponent(draft.clientSlug)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && Array.isArray(data?.tasks)) setNewPlanClientTasks(data.tasks); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isNewPlan, draft.clientSlug]);
  const newPlanCandidates = isNewPlan
    ? newPlanClientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !actionPlanIdOf(t) && !pendingMembers.some((m) => m.kind === "existing" && m.taskId === t.id))
    : [];
  function addPendingExisting(candidate: { id: string; title: string }) {
    setPendingMembers((current) => [...current, { key: `e-${candidate.id}`, kind: "existing", taskId: candidate.id, title: candidate.title }]);
  }
  function addPendingNew(data: { title: string; assignee: string; due_date: string }) {
    setPendingMembers((current) => [...current, { key: `n-${Date.now()}-${current.length}`, kind: "new", ...data }]);
  }
  function removePendingMember(key: string) {
    setPendingMembers((current) => current.filter((m) => m.key !== key));
  }

  // Same idea for an already-saved plan: creates the activity straight away
  // (instead of queueing) and links it via plan_id in the same request.
  async function createLinkedActivity(data: { title: string; assignee: string; due_date: string }) {
    if (!liveTask) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      title: data.title,
      kind: "operacional",
      assignee: data.assignee || null,
      due_date: data.due_date || null,
      start_date: data.due_date || null,
      status: "backlog",
      priority: "media",
      plan_id: liveTask.id,
    };
    try {
      const res = await fetch(`/api/admin/tasks?scope=task`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.clientSlug ? { ...body, slug: draft.clientSlug } : body),
      });
      if (!res.ok) throw new Error();
      onTaskPatched?.(await res.json());
    } catch {
      setError("Não foi possível criar a atividade.");
    }
    setBusy(false);
  }

  // Board feeds intentionally omit future recurring executions. Fetching the
  // direct relation here keeps the parent modal complete without slowing the
  // Tasks screen or making the future card visible there.
  useEffect(() => {
    if (!liveTask || (!kindDef(liveTask.kind).isPlan && !liveTask.recurrence_cadence)) return;
    let cancelled = false;
    fetch(`/api/admin/tasks?parentId=${encodeURIComponent(liveTask.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !Array.isArray(data?.tasks)) return;
        for (const related of data.tasks as TaskRecord[]) onTaskPatchedRef.current?.(related);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [liveTask?.id]);

  async function openRelatedTask(member: TaskRecord) {
    if (!onOpenRelatedTask) return;
    setError("");
    let target = member;
    if (isDeferredTask(member)) {
      setBusy(true);
      try {
        const response = await fetch(`/api/admin/tasks/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: activatedTaskPayload(member.payload) }),
        });
        if (!response.ok) throw new Error();
        target = await response.json() as TaskRecord;
      } catch {
        setError("Não foi possível abrir a execução.");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onOpenRelatedTask(target);
  }

  async function copyCardLink() {
    const id = liveTask?.id ?? task?.id;
    if (!id) return;
    const url = `${window.location.origin}/admin/kanban?task=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch { /* clipboard unavailable; button just won't confirm */ }
  }

  async function sendComment() {
    if (!liveTask || !comment.trim()) return;
    const text = comment.trim();
    setComment("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json() as TaskRecord;
      setLiveTask(updated); onTaskPatched?.(updated);
    } catch { setComment(text); setError("Não foi possível enviar o comentário."); }
  }

  async function completeCycle(retried = false, cycleTask = liveTask): Promise<void> {
    if (!cycleTask?.recurrence_cadence || !cycleTask.due_date) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${cycleTask.id}/complete-cycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCycle: recurrenceCycleOf(cycleTask), expectedRevision: recurrenceRevisionOf(cycleTask), expectedDueDate: cycleTask.due_date }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string; code?: string; parent?: TaskRecord } | null;
        if (!retried && body?.code === "recurrence_schedule_changed" && body.parent) {
          setLiveTask(body.parent);
          setDraft(draftFrom(body.parent, initialStatus, slug, initialAssignee, initialKind, initialRecurrence, creationScope));
          onTaskPatched?.(body.parent);
          setBusy(false);
          await completeCycle(true, body.parent);
          return;
        }
        throw new Error(body?.error ?? "Não foi possível concluir o ciclo.");
      }
      const result = await res.json() as { parent: TaskRecord; task: TaskRecord };
      setLiveTask(result.parent);
      setDraft((current) => ({ ...current, due_date: result.parent.due_date ?? "", end_date: result.parent.end_date ?? current.end_date }));
      onTaskPatched?.(result.parent);
      onTaskPatched?.(result.task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir o ciclo.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft.title.trim()) return;
    setError("");
    if (draft.recurrence_cadence && !draft.start_date.trim()) {
      setError("Informe o início da recorrência.");
      return;
    }
    if (draft.recurrence_cadence && !draft.recurrence_weekdays.length) {
      setError("Selecione pelo menos um dia da semana.");
      return;
    }
    setBusy(true);
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
    delete payload.explicit_occurrence_dates;

    // Agendamento: fold date + time into a single timestamp for the calendar.
    const dateStart = (draft.start_date || draft.due_date).trim();
    const scheduled_start_at =
      dateStart && draft.hora.trim()
        ? `${dateStart}T${draft.hora.trim()}:00`
        : null;

    const body: Record<string, unknown> = {
      title: draft.title.trim(),
      kind: draft.kind,
      subtype: draft.subtype || null,
      status: draft.status,
      priority: draft.priority,
      assignee: draft.assignee.trim() || null,
      assignee_profile_ids: draft.assignee_profile_ids,
      reviewer_id: revisaoOff ? null : draft.reviewer_id || null,
      approver_id: aprovacaoOff ? null : draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      // requires_* are derived from the presence of a revisor/aprovador —
      // "Sem revisor"/"Sem aprovação" means that stage is skipped. A client
      // with the flow admin-disabled never requires it, regardless of draft.
      requires_review: revisaoOff ? false : Boolean(draft.reviewer_id),
      requires_approval: aprovacaoOff ? false : Boolean(draft.approver_id),
      due_date: (liveTask?.recurrence_cadence ? liveTask.due_date : draft.start_date || draft.due_date)?.trim() || null,
      recurrence_cadence: draft.recurrence_cadence,
      recurrence_weekdays: draft.recurrence_cadence ? draft.recurrence_weekdays : [],
      recurrence_day_of_month: draft.recurrence_cadence === "mensal" ? (draft.recurrence_day_of_month ?? 1) : null,
      start_date: draft.start_date.trim() || draft.due_date.trim() || null,
      end_date: draft.end_date.trim() || null,
      scheduled_start_at,
      description: draft.description.trim() || null,
      client_visible: planoVisibilityOn ? draft.client_visible : false,
      payload,
    };
    if (mode === "new" && creationScope === "plan") {
      body.kind = "plano_acao";
    } else if (mode === "new" && creationScope === "routine" && !body.recurrence_cadence) {
      body.recurrence_cadence = "semanal";
    }
    // Cliente is editable in edit mode too now — always send it (as the
    // current draft, whether changed or not) so a real change actually moves
    // the card; null explicitly means "sem cliente".
    if (liveTask) body.slug = draft.clientSlug || null;
    try {
      const res = liveTask
        ? await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/tasks?scope=${creationScope}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            // Omit slug entirely for "sem cliente" — the schema treats an empty
            // string as an invalid slug, not as "no client".
            body: JSON.stringify(draft.clientSlug ? { ...body, slug: draft.clientSlug } : body),
          });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(responseBody?.error ?? "Não foi possível salvar a tarefa.");
      }
      const savedTask = await res.json() as TaskRecord;
      // Activities queued while the plan itself had no id yet: link the
      // existing ones and create the brand-new ones now that it does.
      if (!liveTask && isNewPlan && pendingMembers.length) {
        await Promise.allSettled(pendingMembers.map((member) => {
          if (member.kind === "existing") {
            return fetch(`/api/admin/tasks/${member.taskId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ plan_id: savedTask.id }),
            });
          }
          const memberBody: Record<string, unknown> = {
            title: member.title,
            kind: "operacional",
            assignee: member.assignee || null,
            due_date: member.due_date || null,
            start_date: member.due_date || null,
            status: "backlog",
            priority: "media",
            plan_id: savedTask.id,
          };
          return fetch(`/api/admin/tasks?scope=task`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft.clientSlug ? { ...memberBody, slug: draft.clientSlug } : memberBody),
          });
        }));
      }
      onSaved(savedTask, !liveTask);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a tarefa.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!liveTask) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível excluir.");
      }
      onDeleted(liveTask.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir."); }
    setBusy(false);
  }

  const stepIdx = STATUS_ORDER.indexOf(draft.status);

  return (
    <div className="kb-modal-backdrop" onClick={() => { if (!busy) void closeAfterSave(); }}>
      <div className={`tm tm-tone-${tone} tm-lg`} onClick={(e) => e.stopPropagation()}>
        {mode === "edit" ? (
          <div className={`tm-head tm-head-tone-${tone}`}>
            <div className="tm-head-identity">
              {onBack ? <button type="button" className="tm-back" onClick={() => void closeAfterSave(onBack)} aria-label="Voltar para o card anterior" title="Voltar">←</button> : null}
              <span className="tm-head-ico" aria-hidden>{kindIcon(draft.kind)}</span>
              <div className="tm-head-text">
              <input
                className="tm-title-input"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Título da tarefa"
              />
              <span className="tm-head-client">
                <HeadDropdown className="tm-headpick-client" trigger={<span className="tm-headpick-label">{draftClientName}</span>}>
                  <button type="button" className={`tm-headpick-option ${!draft.clientSlug ? "on" : ""}`} onClick={() => set("clientSlug", "")}>
                    — Sem cliente —
                  </button>
                  {clients.map((c) => (
                    <button
                      type="button"
                      key={c.slug}
                      className={`tm-headpick-option ${draft.clientSlug === c.slug ? "on" : ""}`}
                      onClick={() => set("clientSlug", c.slug)}
                    >
                      {c.name}
                    </button>
                  ))}
                </HeadDropdown>
                {visible("kind") ? (
                  <>
                    <span className="tm-head-sep">·</span>
                    <HeadDropdown
                      className="tm-headpick-kind"
                      trigger={<span className="tm-headpick-label"><span className="tm-headpick-ico" aria-hidden>{kindIcon(draft.kind)}</span>{kindLabel(draft.kind)}</span>}
                    >
                      {creationKinds.map((k) => (
                        <button type="button" key={k} className={`tm-headpick-option ${draft.kind === k ? "on" : ""}`} onClick={() => pickKind(k)}>
                          <span className="tm-headpick-ico" aria-hidden>{kindIcon(k)}</span>{kindLabel(k)}
                        </button>
                      ))}
                    </HeadDropdown>
                  </>
                ) : null}
                {subtypes.length ? (
                  <>
                    <span className="tm-head-sep">·</span>
                    <HeadDropdown
                      className="tm-headpick-subtype"
                      trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabel(draft.subtype) : "Subtipo"}</span>}
                    >
                      <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>— Sem subtipo —</button>
                      {subtypes.map((subtype) => (
                        <button type="button" key={subtype} className={`tm-headpick-option ${draft.subtype === subtype ? "on" : ""}`} onClick={() => set("subtype", subtype)}>
                          {subtypeLabel(subtype)}
                        </button>
                      ))}
                    </HeadDropdown>
                  </>
                ) : null}
                </span>
              </div>
            </div>
            <div className="tm-stepper tm-stepper-head" aria-label="Progresso da tarefa">
              {progressColumns.map((column, visibleIndex) => (
                  <button
                    type="button"
                    key={column.status}
                    className={`tm-step ${STATUS_ORDER.indexOf(column.status) <= stepIdx ? "done" : ""} ${draft.status === column.status ? "current" : ""}`}
                    onClick={() => set("status", column.status)}
                  >
                    <span className="tm-step-dot" />
                    <span className="tm-step-label">{column.label}</span>
                    {visibleIndex < progressColumns.length - 1 ? <span className="tm-step-line" /> : null}
                  </button>
              ))}
            </div>
            <div className="tm-head-actions">
              {visible("progress") ? (
                <div className="tm-head-progress" title={`Progresso ${headerPct}%`}>
                  <span><span style={{ width: `${headerPct}%` }} /></span>
                  <b>{headerPct}%</b>
                </div>
              ) : null}
              <AttrVisibilityPopover attrs={attrsForKind} />
              <button className="kb-modal-close" onClick={() => void closeAfterSave()} aria-label="Fechar">✕</button>
            </div>
          </div>
        ) : (
          <div className="tm-head tm-head-plain">
            <div className="tm-head-text">
              <div className="tm-new-headline">
                <h2>Nova Tarefa</h2>
                <HeadDropdown
                  className="tm-new-kind"
                  trigger={<span className="tm-headpick-label"><span className="tm-headpick-ico" aria-hidden>{kindIcon(draft.kind)}</span>{kindLabel(draft.kind)}</span>}
                >
                  {creationKinds.map((kind) => (
                    <button type="button" key={kind} className={`tm-headpick-option ${draft.kind === kind ? "on" : ""}`} onClick={() => pickKind(kind)}>
                      <span className="tm-headpick-ico" aria-hidden>{kindIcon(kind)}</span>{kindLabel(kind)}
                    </button>
                  ))}
                </HeadDropdown>
                {subtypes.length ? (
                  <HeadDropdown className="tm-new-kind" trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabel(draft.subtype) : "Subtipo"}</span>}>
                    <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>— Sem subtipo —</button>
                    {subtypes.map((subtype) => <button type="button" key={subtype} className={`tm-headpick-option ${draft.subtype === subtype ? "on" : ""}`} onClick={() => set("subtype", subtype)}>{subtypeLabel(subtype)}</button>)}
                  </HeadDropdown>
                ) : null}
              </div>
              <p className="admin-sub">Conte o essencial e escolha o tipo do card.</p>
            </div>
            <button className="kb-modal-close" onClick={() => void closeAfterSave()} aria-label="Fechar">✕</button>
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
                <span className="tm-newclient">
                  {draftClientName}
                  {initialKind ? (
                    <span className="tm-newtype-badge">
                      <span aria-hidden>{kindIcon(initialKind)}</span> {kindLabel(initialKind)}
                    </span>
                  ) : null}
                </span>
                <AutoGrowTextarea
                  className="tm-desc-input"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Objetivo, referência e critério de pronto."
                />
              </div>
            ) : null}

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
              {/* Vínculo com plano (não para o próprio plano) */}
              {!kd.isPlan && !(mode === "new" && creationScope === "routine") ? (
                <Cell icon="◆" label="Plano de Ação" hidden={!visible("plan_link")}>
                  <select value={draft.plan_id} onChange={(e) => set("plan_id", e.target.value)}>
                    <option value="">— Sem plano —</option>
                    {planCandidates
                      .filter((p) => p.id !== liveTask?.id)
                      .map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </Cell>
              ) : null}

              {/* Um único campo inteligente concentra início, fim opcional,
                  horário e recorrência. Dia do mês vive dentro do calendário. */}
              <Cell icon="▦" label="Data">
                <CalendarPicker
                  value={draft.start_date || draft.due_date}
                  onChange={(value) => setDraft((current) => {
                    const day = value ? new Date(`${value}T12:00:00`).getDay() : null;
                    return {
                      ...current,
                      start_date: value,
                      due_date: liveTask?.recurrence_cadence ? current.due_date : value,
                      end_date: value && (!current.end_date || current.end_date < value) ? value : current.end_date,
                      recurrence_weekdays: current.recurrence_cadence && !current.recurrence_weekdays.length && day !== null ? [day] : current.recurrence_weekdays,
                    };
                  })}
                  endValue={draft.end_date}
                  onEndChange={(value) => set("end_date", value)}
                  timeValue={draft.hora}
                  onTimeChange={(value) => set("hora", value)}
                  placeholder="Sem data"
                  recurrence={{ cadence: draft.recurrence_cadence, weekdays: draft.recurrence_weekdays, dayOfMonth: draft.recurrence_day_of_month }}
                  onRecurrenceChange={(value) => setDraft((current) => ({ ...current, recurrence_cadence: value.cadence, recurrence_weekdays: value.weekdays, recurrence_day_of_month: value.dayOfMonth }))}
                  recurrenceFeatureEnabled
                  recurrenceRequired={mode === "new" && creationScope === "routine"}
                  nextExecutionValue={isRecurringParent ? liveTask?.due_date ?? undefined : undefined}
                />
              </Cell>

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

              {/* Multiple people stay backwards-compatible in one DB field,
                  but behave as a reusable list in the editor. */}
              <Cell icon="◔" label="Responsável" hidden={!visible("assignee")}>
                <AssigneePicker
                  assignee={draft.assignee}
                  assigneeProfileIds={draft.assignee_profile_ids}
                  accountOptions={adminReviewers}
                  freeTextOptions={assignees}
                  onChange={({ assignee, assigneeProfileIds }) =>
                    setDraft((current) => ({ ...current, assignee: assignee ?? "", assignee_profile_ids: assigneeProfileIds }))
                  }
                  disabled={busy}
                />
              </Cell>

              <Cell icon="⚑" label="Status" hidden={!visible("status")}>
                <span className="tm-cell-static">{STATUS_LABEL[draft.status]}</span>
              </Cell>
              <Cell icon="⚑" label="Prioridade" hidden={!visible("priority")}>
                <select value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Cell>

            </div>

            {liveTask && recurrenceParentId ? (
              <div className="tm-box tm-planmembers">
                <p className="tm-box-label">Card pai (1)</p>
                <div className="tm-member-list">
                  {recurrenceParent ? (
                    <div className="tm-member">
                      <button
                        type="button"
                        className="tm-member-unlink"
                        title="Remover ligação com o card pai"
                        aria-label="Remover ligação com o card pai"
                        onClick={() => void unlinkMember(liveTask.id, recurrenceParent.id)}
                        disabled={busy}
                      >✕</button>
                      <button type="button" className="tm-member-open" onClick={() => void openRelatedTask(recurrenceParent)} disabled={!onOpenRelatedTask || busy}>
                        <TaskKindIcon kind={recurrenceParent.kind} size="sm" />
                        <span className="tm-member-title">{recurrenceParent.title}</span>
                        <span className="tm-member-status">{STATUS_LABEL[recurrenceParent.status]}</span>
                        <span className="tm-member-arrow" aria-hidden>↗</span>
                      </button>
                    </div>
                  ) : <p className="admin-sub" style={{ margin: 0 }}>Carregando card pai…</p>}
                </div>
              </div>
            ) : null}

            {((kd.isPlan || isRecurringParent) && liveTask) || isNewPlan ? (
              <div className="tm-box tm-planmembers">
                <p className="tm-box-label">
                  {isRecurringParent ? "Execuções da recorrência" : "Atividades do plano"} ({liveTask ? planMembers.length : pendingMembers.length})
                </p>
                <div className="tm-member-list">
                  {liveTask ? (
                    planMembers.map((m) => (
                      <div className="tm-member" key={m.id}>
                        <button
                          type="button"
                          className="tm-member-unlink"
                          title={isRecurringParent ? "Remover ligação com esta execução" : "Desvincular do plano"}
                          aria-label={isRecurringParent ? `Remover ligação com ${m.title}` : `Desvincular ${m.title} do plano`}
                          onClick={() => void unlinkMember(m.id, liveTask.id)}
                          disabled={busy}
                        >✕</button>
                        <button type="button" className="tm-member-open" onClick={() => void openRelatedTask(m)} disabled={!onOpenRelatedTask || busy}>
                          <TaskKindIcon kind={m.kind} size="sm" />
                          <span className="tm-member-title">{m.title}</span>
                          <span className="tm-member-status">{isDeferredTask(m) ? "Futura · abrir tarefa" : STATUS_LABEL[m.status]}</span>
                          <span className="tm-member-arrow" aria-hidden>↗</span>
                        </button>
                      </div>
                    ))
                  ) : (
                    pendingMembers.map((m) => (
                      <div className="tm-member" key={m.key}>
                        <button type="button" className="tm-member-unlink" title="Remover" aria-label={`Remover ${m.title}`} onClick={() => removePendingMember(m.key)}>✕</button>
                        <span className="tm-member-open tm-member-pending">
                          <TaskKindIcon kind="operacional" size="sm" />
                          <span className="tm-member-title">{m.title}</span>
                          <span className="tm-member-status">
                            {m.kind === "existing" ? "Vincular ao criar" : [m.assignee, m.due_date].filter(Boolean).join(" · ") || "Criar ao salvar"}
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                  {(liveTask ? planMembers.length : pendingMembers.length) === 0 ? (
                    <p className="admin-sub" style={{ margin: 0 }}>
                      {isRecurringParent ? "Conclua o ciclo atual para criar a próxima execução." : "Nenhuma atividade vinculada ainda."}
                    </p>
                  ) : null}
                </div>
                {!isRecurringParent ? (
                  <PlanMemberComposer
                    candidates={liveTask ? linkableCandidates : newPlanCandidates}
                    assignees={assignees}
                    defaultAssignee={draft.assignee}
                    defaultDueDate={draft.start_date || draft.due_date}
                    busy={busy}
                    onLinkExisting={(c) => { if (liveTask) void linkMember(c.id, liveTask.id); else addPendingExisting(c); }}
                    onCreateNew={(data) => { if (liveTask) void createLinkedActivity(data); else addPendingNew(data); }}
                  />
                ) : null}
              </div>
            ) : null}

            {shouldRenderClientVisibilityToggle(planoVisibilityOn) ? (
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
                {editingDescription ? (
                  <AutoGrowTextarea
                    className="tm-desc-input"
                    rows={3}
                    autoFocus
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                    onBlur={() => setEditingDescription(false)}
                    placeholder="Objetivo, referência e critério de pronto entram aqui antes de enviar para o quadro."
                  />
                ) : (
                  <div
                    className="tm-desc-input tm-desc-view"
                    onDoubleClick={() => setEditingDescription(true)}
                    title="Clique duas vezes para editar"
                  >
                    {draft.description ? (
                      <CommentText text={draft.description} />
                    ) : (
                      <span className="tm-desc-placeholder">Objetivo, referência e critério de pronto entram aqui antes de enviar para o quadro.</span>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {error ? <p className="admin-error">{error}</p> : null}
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
                        <p className="tm-comment-meta"><b>{c.author}</b><small>{formatCommentTime(c.at)}</small></p>
                        <p className="tm-comment-text"><CommentText text={c.text} /></p>
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

        <footer className="kb-modal-actions">
          {liveTask ? <button className="admin-btn ghost danger" onClick={remove} disabled={busy}>Excluir</button> : <span />}
          {mode === "edit" ? <span className={`tm-autosave tm-autosave-${autosave.state}`} role="status" aria-live="polite">
            {autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "saving" ? "Salvando…" : autosave.state === "error" ? <button type="button" onClick={() => void autosave.retry()}>Erro ao salvar — Tentar novamente</button> : "Salvo"}
          </span> : <span />}
          <div className="kb-modal-actions-right">
            {liveTask ? <button type="button" className="admin-btn ghost tm-copylink" onClick={copyCardLink} title="Copiar link direto para este card">
              {linkCopied ? "Link copiado" : "🔗 Copiar link"}
            </button> : null}
            {liveTask?.recurrence_cadence ? <button className="admin-btn ghost rec-complete" onClick={() => void completeCycle()} disabled={busy || !liveTask?.due_date}>✓ Concluir ciclo</button> : null}
            {mode === "new" ? <button className="admin-btn ghost" onClick={() => void closeAfterSave()} disabled={busy}>Cancelar</button> : null}
            {mode === "new" ? <button className={`admin-btn primary tm-btn-${tone}`} onClick={save} disabled={busy || !draft.title.trim()}>
              {busy ? "Salvando…" : "Criar card"}
            </button> : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
