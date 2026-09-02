"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AttrVisibilityPopover from "./AttrVisibilityPopover";
import CalendarPicker, { type CalendarRecurrence } from "./CalendarPicker";
import AssigneePicker from "./AssigneePicker";
import TaskKindIcon from "./TaskKindIcon";
import FlowStepsBox from "./FlowStepsBox";
import CardParentBox from "./CardParentBox";
import VisibleToggleField from "./VisibleToggleField";
import { shouldRenderClientVisibilityToggle } from "./visibilityRules";
import { ATTR_DEFS, useAttrVisibility } from "./kanbanAttrs";
import {
  COLUMNS, FORMATO_OPTIONS, PLATAFORMA_OPTIONS, PRIORITY_LABEL, STATUS_LABEL, WORKFLOW_ORDER,
  TONES, commentsOf, initials,
} from "./kanbanShared";
import CommentAvatar from "./CommentAvatar";
import CardCover from "./CardCover";
import { taskCoverCandidates, taskDriveFolders } from "@/lib/taskCover";
import CardDriveFolders from "./CardDriveFolders";
import CommentText from "@/app/CommentText";
import { useCurrentAdminUser } from "./CurrentUserContext";
import { formatAbsoluteTime, formatCommentTime, mergeFamilyComments, splitCommentText, type FamilyComment } from "@/lib/comments";
import { normalizeSearchText } from "@/lib/taskSearch";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { TASK_KINDS, TASK_KIND_KEYS, canonicalTaskClassification, kindDef, kindIcon, kindLabel, kindTone, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import { actionPlanMembersOf, activatedTaskPayload, deliveryParentIdsOf, flowStepKeyOf, flowStepsOf, isDeferredTask, isFlowDelivery, planParentIdOf, recurrenceExecutionsOf, recurrenceParentIdOf, recurrenceParentOf } from "@/lib/taskRelations";
import { recurrenceCycleOf, recurrenceRevisionOf, recurrenceStopped } from "@/lib/recurrenceState";
import { fileTypeLabel, isHtmlDocument } from "@/lib/documentFiles";
import type { AdminDocument } from "@/lib/supabase";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { useTaskAutosave } from "./useTaskAutosave";
import DocumentPreviewModal from "./documentos/DocumentPreviewModal";
import BackArrowIcon from "./BackArrowIcon";

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

// O contexto de criação NÃO vem mais de fora — o botão é o mesmo em toda tela.
// O que nasce é decidido pelo TIPO escolhido no dropdown do modal, e este valor
// é derivado desse tipo (ver `effectiveScope`), só para dizer ao servidor qual
// caminho seguir. "flow-step" = escolher um subtipo de entrega em vez de "Fluxo
// completo": cria só o card daquela etapa, solto.
export type TaskCreationScope = "task" | "plan" | "routine" | "flow-step";

/** Pré-preenchimento opcional que uma tela pode passar — nunca comportamento.
 *  Ex.: o "+" embaixo de uma coluna do quadro abre o modal já com aquele status. */
export type TaskCreationPrefill = { clientSlug?: string; status?: TaskStatus; assignee?: string };

type PendingMember =
  | { key: string; kind: "existing"; taskId: string; title: string }
  | { key: string; kind: "new"; title: string; assignee: string; due_date: string };

function draftFrom(
  task: TaskRecord | null,
  initialSlug: string,
  prefill?: TaskCreationPrefill,
): Draft {
  const initialStatus = prefill?.status;
  const initialAssignee = prefill?.assignee;
  const requestedKind = task?.kind ?? "operacional";
  const classification = canonicalTaskClassification(requestedKind, task?.subtype);
  const p = (task?.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  return {
    title: task?.title ?? "",
    kind: classification.kind,
    clientSlug: prefill?.clientSlug ?? initialSlug,
    subtype: classification.subtype ?? "",
    status: task?.status ?? initialStatus ?? "backlog",
    priority: task?.priority ?? "media",
    assignee: task?.assignee ?? initialAssignee ?? "",
    assignee_profile_ids: task?.assignee_profile_ids ?? [],
    reviewer_id: task?.reviewer_id ?? "",
    approver_id: task?.approver_id ?? "",
    // O elo SEM slot. `parents[0]` era cego a slot e a consulta não tem
    // ORDER BY: numa etapa que também é membro de plano, "o primeiro pai"
    // podia ser a entrega, e o autosave mandava o id dela como plano —
    // apagando a associação real.
    plan_id: task ? planParentIdOf(task) ?? "" : "",
    due_date: task?.due_date ?? "",
    recurrence_cadence: task?.recurrence_cadence ?? null,
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

// A quinta porta de criação. Uma linha de `task_types` NÃO serviria: `behavior`
// é CHECK-constrained a ('entrega','plano','simples'), e um kind próprio
// tornaria "entrega recorrente" irrepresentável. Isto é vocabulário de tela.
const ROTINA_KEY = "__rotina";
const ROTINA_OPTION = {
  key: ROTINA_KEY,
  label: "Rotina",
  icon: "↻",
  behavior: "simples" as const,
  creatable: true,
  active: true,
  id: ROTINA_KEY,
  order_index: 999,
  subtypes: [],
};

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

export function AutoGrowTextarea({ onChange, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
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

  // Só título aqui de propósito: `candidates` chega como um shape reduzido
  // ({ id, title, kind }) para este picker. Ainda assim normaliza acento nos
  // dois lados, como o resto da busca. Alargar a prop para TaskRecord[] e usar
  // taskMatchesQuery é um follow-up.
  const needle = normalizeSearchText(query.trim());
  const matches = needle ? candidates.filter((c) => normalizeSearchText(c.title).includes(needle)).slice(0, 6) : [];
  const exact = needle ? candidates.some((c) => normalizeSearchText(c.title) === needle) : false;

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
  prefill,
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
  prefill?: TaskCreationPrefill;
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, slug, prefill));
  // "Rotina" é a quinta porta de criação, e é só isso: uma porta.
  //
  // Ela NÃO é um kind. Recorrência é a coluna `recurrence_cadence`, ortogonal
  // ao tipo, e é justamente essa ortogonalidade que permite uma ENTREGA
  // recorrente — um `kind: "rotina"` tornaria a combinação irrepresentável.
  // Escolher Rotina aqui é escolher Tarefa com cadência, o que no servidor é
  // `scope=routine`: cria o MOLDE da recorrência, não um grupo já
  // materializado (ver POST /api/admin/tasks).
  const [rotinaMode, setRotinaMode] = useState(false);
  const [liveTask, setLiveTask] = useState<TaskRecord | null>(task);
  // A recurrence template is a parent even if legacy data accidentally still
  // carries a child-only recurrence_parent_id. It must never render a second
  // "Card pai" box or try to fetch itself as a parent.
  const isRecurringParent = Boolean(liveTask?.recurrence_cadence || liveTask?.payload?.recurrence_group === true);
  const recurrenceParentId = liveTask && !isRecurringParent ? recurrenceParentIdOf(liveTask) : null;
  const [recurrenceParent, setRecurrenceParent] = useState<TaskRecord | null>(() => recurrenceParentOf(recurrenceParentId, clientTasks));
  // Vocabulário (tipos + subtipos) vindo de task_types. É a fonte dos dois
  // dropdowns do cabeçalho E das etapas de uma entrega — um fluxo É um tipo e
  // suas etapas SÃO os subtipos dele, então não há duas listas para sincronizar.
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([]);
  // A ENTREGA é o card marcado com payload.flow_parent; a ETAPA é um filho dela
  // cujo subtipo diz que etapa é.
  const isDelivery = Boolean(liveTask && isFlowDelivery(liveTask));
  const [flowDelivery, setFlowDelivery] = useState<TaskRecord | null>(null);
  // O Plano de Ação a que este card pertence — não aparece no quadro, então
  // quase sempre precisa ser buscado por id (igual a `flowDelivery`).
  const [planParent, setPlanParent] = useState<TaskRecord | null>(null);
  // A etapa recém-criada pela conclusão desta, devolvida pelo PATCH.
  const [flowNext, setFlowNext] = useState<TaskRecord | null>(null);
  const currentType = taskTypes.find((t) => t.key === draft.kind) ?? null;
  // O que o servidor vai criar, derivado do TIPO escolhido no dropdown — não de
  // uma prop. Rotina (porta sintética) → molde recorrente; tipo-entrega com
  // "Fluxo completo" → a corrente; tipo-entrega com um subtipo → só aquele card
  // ("flow-step"); Plano de Ação → agregador; o resto → card comum.
  const effectiveScope: TaskCreationScope =
    mode !== "new" ? "task"
    : rotinaMode ? "routine"
    : currentType?.behavior === "entrega" && draft.subtype ? "flow-step"
    : draft.kind === "plano_acao" ? "plan"
    : "task";
  const deliveryType = taskTypes.find((t) => t.key === (flowDelivery?.kind ?? (isDelivery ? liveTask?.kind : null))) ?? null;
  // Índice 1-based da etapa dentro do tipo, para o "2/4". -1 enquanto o
  // vocabulário não chegou, ou se o subtipo saiu do tipo depois de o card já
  // existir — nesse caso o card segue válido, só não numera.
  const flowStepIndex = deliveryType && liveTask ? deliveryType.subtypes.findIndex((sub) => sub.key === liveTask.subtype) : -1;
  const [comment, setComment] = useState("");
  // Comentário em edição inline. Guarda o `at` que estava na tela para o
  // servidor recusar se a thread mudou (ver edit_task_comment).
  const [editingComment, setEditingComment] = useState<{ index: number; at: string; text: string } | null>(null);
  // Documents attachable to a comment — pdf/other files, not Trilhas HTML
  // decks. Lazily fetched once per edit session (small, agency-wide list;
  // same "all documents" endpoint Informações uses).
  const [attachableDocs, setAttachableDocs] = useState<AdminDocument[]>([]);
  useEffect(() => {
    if (mode !== "edit") return;
    let cancelled = false;
    fetch("/api/admin/documents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { documents: AdminDocument[] } | null) => {
        if (!cancelled && data) setAttachableDocs(data.documents.filter((d) => !isHtmlDocument(d)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);
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
  // Um card já existente sempre mostra o próprio tipo, mesmo que ele seja
  // oculto (uma etapa de fluxo é kind=criativo, que saiu do dropdown) — senão
  // o pill viria vazio ou trocaria o tipo do card sozinho ao abrir.
  // Uma porta só: na criação o dropdown de Tipo lista TUDO que se pode criar —
  // Tarefa, Plano de Ação, cada entrega, e a porta sintética Rotina. Escolher o
  // tipo é que decide o que nasce; nenhuma tela restringe mais essa lista. Fora
  // ficam só os tipos não-criáveis (checkpoint comercial, que é provisionado);
  // em edição, um card que já é plano só troca por outro plano.
  const realTypes = taskTypes.filter((type) => {
    if (!type.creatable && type.key !== draft.kind) return false;
    if (mode === "edit" && kd.isPlan) return type.behavior === "plano";
    return true;
  });
  // Rotina só aparece na criação: em edição o Tipo mostra o kind real do card e
  // a recorrência tem campo próprio.
  const creationTypes = mode === "new" ? [...realTypes, ROTINA_OPTION] : realTypes;
  const typeLabelOf = (key: string) => taskTypes.find((t) => t.key === key)?.label ?? kindLabel(key);
  const subtypeOptions = currentType?.subtypes ?? [];
  const subtypeLabelOf = (key: string) => subtypeOptions.find((sub) => sub.key === key)?.label ?? subtypeLabel(key);
  // The Cliente attribute can change the target client in both modes now, so
  // the header label tracks the draft instead of the (possibly stale) prop.
  // Falls back to the prop for edit mode before `clients` has loaded.
  const draftClientName = draft.clientSlug
    ? (clients.find((c) => c.slug === draft.clientSlug)?.name ?? clientName ?? "Sem cliente")
    : (mode === "new" ? "Sem cliente" : clientName);
  const attrsForKind = ATTR_DEFS.filter((a) => a.kinds === "base" || (a.kinds as string[]).includes(draft.kind));
  // Revisão / Aprovação são amarradas à tela Configurações › Etapas: a flag
  // `revisaoAdmin` / `aprovacaoAdmin` (por cliente) é o ÚNICO critério. Etapa
  // desligada → o campo some do modal, `requires_*` vai a false no save, e o
  // passo some do stepper. Não há override — se está desligado, está desligado.
  // Enquanto flowFlags não carregou (null), assume desligado (o campo não
  // pisca visível durante o fetch para sumir logo em seguida).
  const revisaoOff = flowFlags ? !flowFlags.revisaoAdmin : true;
  const aprovacaoOff = flowFlags ? !flowFlags.aprovacaoAdmin : true;
  // Um card que JÁ está parado na etapa desligada continua mostrando o próprio
  // passo, para a posição atual nunca ficar literalmente invisível.
  const revisaoStepHidden = revisaoOff && draft.status !== "revisao";
  const aprovacaoStepHidden = aprovacaoOff && draft.status !== "aprovacao";
  // Revisão e Aprovação são as únicas etapas que somem, e por CLIENTE, não por
  // tipo: são contrato de cliente, não modelo de card. O recorte por tipo que
  // existia aqui era o "Publicado", que deixou de ser etapa.
  const progressColumns = COLUMNS.filter((column) => {
    if (column.status === "revisao") return !revisaoStepHidden;
    if (column.status === "aprovacao") return !aprovacaoStepHidden;
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
  const acceptAutosave = useCallback((updated: TaskRecord & { flow_next_task?: TaskRecord }) => {
    // Concluir uma etapa cria a próxima no mesmo request. O servidor devolve
    // esse card junto para a pessoa não ficar olhando uma etapa concluída sem
    // caminho nenhum para o trabalho seguinte — antes era preciso fechar e
    // reabrir para achá-lo. Guardado, não navegado: pular de card sozinho
    // surpreenderia e poderia levar embora uma edição em andamento.
    const { flow_next_task: next, ...task } = updated;
    if (next) {
      setFlowNext(next);
      onTaskPatchedRef.current?.(next);
    }
    setLiveTask(task as TaskRecord);
    onTaskPatchedRef.current?.(task as TaskRecord);
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

  // O thread de comentários é da FAMÍLIA só quando o card aberto É o pai — um
  // Plano de Ação (mostra ele + as atividades) ou uma Entrega (ele + as etapas).
  // O card FILHO mostra só os próprios comentários. Recorrência fica de fora:
  // cada ciclo é uma entrega própria; uma entrega-ocorrência ainda junta as
  // etapas dela porque aí `isDelivery` é true.
  const isFamilyParent = liveTask ? (kd.isPlan || isDelivery) : false;
  const familyCards = useMemo(() => {
    if (!liveTask || !isFamilyParent) return liveTask ? [liveTask] : [];
    const members = kd.isPlan
      ? actionPlanMembersOf(liveTask.id, clientTasks)
      : flowStepsOf(liveTask.id, clientTasks);
    const seen = new Set([liveTask.id]);
    const out: TaskRecord[] = [liveTask];
    for (const member of members) if (!seen.has(member.id)) { seen.add(member.id); out.push(member); }
    return out;
  }, [liveTask, clientTasks, isDelivery, isFamilyParent, kd.isPlan]);

  const ownComments = liveTask ? commentsOf(liveTask) : [];
  const comments: FamilyComment[] = !liveTask
    ? []
    : isFamilyParent
      ? mergeFamilyComments(familyCards)
      : ownComments.map((comment) => ({ ...comment, taskId: liveTask.id }));
  // Same client first (most relevant), other clients' documents below —
  // never hidden entirely, since a comment can reasonably reference either.
  const commentDocs = draft.clientSlug
    ? [...attachableDocs.filter((d) => d.clientSlug === draft.clientSlug), ...attachableDocs.filter((d) => d.clientSlug !== draft.clientSlug)]
    : attachableDocs;
  // Anexos = documents attached directly to THIS card (documents.task_id, e.g.
  // a report an automation generated) UNION any document a comment happens to
  // link to (file link pasted/posted in the thread) — every file link in a
  // comment becomes an icon here too, not just direct task_id attachments.
  const taskDocs = useMemo(() => {
    if (!liveTask) return [];
    // Anexos ficam por card, não por família — o thread de comentários é
    // compartilhado, os arquivos não. Por isso varre `ownComments`, não o merge.
    const byId = new Map(attachableDocs.filter((d) => d.task_id === liveTask.id).map((d) => [d.id, d]));
    for (const c of ownComments) {
      for (const part of splitCommentText(c.text)) {
        if (!("url" in part)) continue;
        const doc = attachableDocs.find((d) => d.file_url === part.url);
        if (doc) byId.set(doc.id, doc);
      }
    }
    return Array.from(byId.values());
  }, [liveTask, attachableDocs, ownComments]);
  const [previewDoc, setPreviewDoc] = useState<AdminDocument | null>(null);
  // A comment link that matches a known document's file_url opens the same
  // preview modal in place instead of navigating to the raw file in a new tab.
  function openDocForUrl(url: string): boolean {
    const doc = attachableDocs.find((d) => d.file_url === url);
    if (!doc) return false;
    setPreviewDoc(doc);
    return true;
  }
  function attachDocToComment(doc: AdminDocument) {
    // [label](url) renders as a short link (the file's own name) instead of
    // the raw URL — see lib/comments.ts splitCommentText.
    const link = doc.file_url ? `📎 [${doc.name}](${doc.file_url})` : `📎 ${doc.name}`;
    setComment((current) => (current.trim() ? `${current}\n${link}` : link));
  }
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

  // Um GET por abertura de modal: o vocabulário é config pequena e estável, e
  // agora todo card precisa dele (os dropdowns de Tipo e Subtipo saem daqui).
  useEffect(() => {
    if (taskTypes.length) return;
    let cancelled = false;
    fetch("/api/admin/task-types")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { types: TaskTypeDef[] } | null) => {
        if (!cancelled && data?.types) setTaskTypes(data.types);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskTypes.length]);

  useEffect(() => { setFlowNext(null); }, [liveTask?.id]);

  // O `slot` do elo já diz qual pai é entrega — a resposta é síncrona e exata,
  // sem depender de o pai estar carregado. O fallback "pega o primeiro pai" que
  // morava aqui é o que fazia um card cujo único pai é um Plano abrir com a
  // caixa "Entrega / Carregando entrega…" para sempre.
  const flowDeliveryId = liveTask && !isDelivery ? deliveryParentIdsOf(liveTask)[0] ?? null : null;
  useEffect(() => {
    if (!flowDeliveryId) { setFlowDelivery(null); return; }
    // Só ENTREGA vira corrente. `flowDeliveryId` cai no primeiro pai quando
    // nenhum pai carregado é entrega — e um card pode ter como único pai um
    // Plano de Ação, que não aparece no quadro e por isso costuma não estar em
    // clientTasks. Sem esta guarda a caixa "Etapas" renderiza com o Plano no
    // papel de entrega e mostra uma corrente `(N/0)` que não existe. Filtrar
    // por id não resolve, porque o pai frequentemente não está carregado; a
    // checagem tem que ser DEPOIS de ter o card em mãos.
    const asDelivery = (parent: TaskRecord | null) => (parent && isFlowDelivery(parent) ? parent : null);
    const loaded = clientTasks.find((t) => t.id === flowDeliveryId) ?? null;
    if (loaded) { setFlowDelivery(asDelivery(loaded)); return; }
    let cancelled = false;
    // A entrega não aparece no quadro, então frequentemente não está em
    // clientTasks — buscar por id é o caminho normal aqui, não a exceção.
    fetch(`/api/admin/tasks/${encodeURIComponent(flowDeliveryId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((parent: TaskRecord | null) => { if (!cancelled) setFlowDelivery(asDelivery(parent)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [flowDeliveryId, clientTasks]);

  // O mesmo, para o Plano de Ação a que o card pertence (elo sem slot). Igual à
  // entrega, o plano não aparece no quadro, então o normal é buscar por id.
  const planParentId = liveTask && !isDelivery && !isRecurringParent && !kindDef(liveTask.kind).isPlan
    ? planParentIdOf(liveTask)
    : null;
  useEffect(() => {
    if (!planParentId) { setPlanParent(null); return; }
    const asPlan = (parent: TaskRecord | null) => (parent && kindDef(parent.kind).isPlan ? parent : null);
    const loaded = clientTasks.find((t) => t.id === planParentId) ?? null;
    if (loaded) { setPlanParent(asPlan(loaded)); return; }
    let cancelled = false;
    fetch(`/api/admin/tasks/${encodeURIComponent(planParentId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((parent: TaskRecord | null) => { if (!cancelled) setPlanParent(asPlan(parent)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [planParentId, clientTasks]);

  function pickKind(kind: string) {
    if (kind === ROTINA_KEY) {
      setRotinaMode(true);
      setDraft((d) => ({
        ...d,
        kind: "operacional",
        subtype: "",
        plan_id: "",
        recurrence_cadence: d.recurrence_cadence ?? "semanal",
      }));
      return;
    }
    const wasRotina = rotinaMode;
    setRotinaMode(false);
    setDraft((d) => {
      const def = kindDef(kind);
      const type = taskTypes.find((t) => t.key === kind);
      // Rotina liga a recorrência de forma implícita (ver acima). Sair dela para
      // qualquer outro tipo tem que apagar essa recorrência — senão o seletor do
      // calendário fica marcado num tipo que não pediu. Entrega NÃO limpa mais:
      // toda tarefa, entrega ou não, pode ser recorrente.
      const clearRecurrence = wasRotina;
      return {
        ...d,
        kind,
        // Trocar de tipo troca o vocabulário de subtipo. Uma entrega abre em
        // "Fluxo completo" (subtype vazio) — a corrente inteira; escolher um
        // subtipo ali cria só aquele card. Os demais tipos abrem no primeiro
        // subtipo declarado (é assim que Operacional já nasce em "Gestão").
        subtype: type?.behavior === "entrega" ? "" : type?.subtypes[0]?.key ?? "",
        // A plan can't belong to another plan.
        plan_id: def.isPlan ? "" : d.plan_id,
        recurrence_cadence: clearRecurrence ? null : d.recurrence_cadence,
        recurrence_weekdays: clearRecurrence ? [] : d.recurrence_weekdays,
        recurrence_day_of_month: clearRecurrence ? null : d.recurrence_day_of_month,
      };
    });
  }

  // Plan ↔ activity linking (for plano_acao cards): members are tasks whose
  // plan_id points here; candidates are the client's still-unlinked non-plan
  // tasks. Linking/unlinking just PATCHes the activity's plan_id.
  const planMembers = liveTask
    ? (isRecurringParent ? recurrenceExecutionsOf(liveTask.id, clientTasks) : actionPlanMembersOf(liveTask.id, clientTasks))
    : [];
  const flowSteps = liveTask && isDelivery ? flowStepsOf(liveTask.id, clientTasks) : [];
  // Unsaved status changes are the task's current UI truth. Reading liveTask
  // here left the percentage frozen until Save, even while the stepper moved.
  const progressTask = liveTask ? { ...liveTask, kind: draft.kind, status: draft.status } : null;
  const headerPct = progressTask
    ? (isDelivery
        ? taskProgress(progressTask, flowSteps)
        : kd.isPlan || isRecurringParent ? taskProgress(progressTask, planMembers) : taskProgress(progressTask))
    : 0;
  const linkableCandidates = liveTask
    // Ter uma entrega como pai não impede mais entrar num plano — é
    // justamente a combinação que passou a ser suportada. O que impede é já
    // estar em outro plano.
    ? clientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !planParentIdOf(t) && t.client_id === liveTask.client_id)
    : [];
  /** A entrega a que a caixa de etapas se refere: o próprio card quando ele é a
   * entrega, ou o pai quando estamos olhando uma etapa (usado só para calcular o
   * progresso do pai na caixa "Faz parte de" — o stepper editável agora só
   * aparece do lado da entrega). */
  const chainDelivery = isDelivery ? liveTask : flowDelivery;

  // As etapas da corrente a que este card pertence — as do próprio card quando
  // ele é a entrega, as do pai quando ele é uma etapa.
  const chainSteps = chainDelivery ? flowStepsOf(chainDelivery.id, clientTasks) : [];

  // As caixas "Faz parte de" do modal de um FILHO: uma linha enxuta por card
  // pai (entrega, plano, molde de recorrência), só para navegar. Um card pode
  // ser etapa de uma entrega E atividade de um plano ao mesmo tempo, daí a lista.
  const parentBoxes: { parent: TaskRecord; subtitle: string; progress: number }[] = [];
  if (liveTask && !isDelivery && !kd.isPlan) {
    if (flowDelivery) {
      const total = deliveryType?.subtypes.length ?? 0;
      const stepLabel = subtypeLabelOf(liveTask.subtype ?? "") || "Etapa do fluxo";
      parentBoxes.push({
        parent: flowDelivery,
        subtitle: flowStepIndex >= 0 && total ? `Etapa ${flowStepIndex + 1} de ${total} · ${stepLabel}` : stepLabel,
        progress: taskProgress(flowDelivery, chainSteps),
      });
    }
    if (planParent) {
      parentBoxes.push({
        parent: planParent,
        subtitle: "Atividade do plano",
        progress: taskProgress(planParent, actionPlanMembersOf(planParent.id, clientTasks)),
      });
    }
    if (recurrenceParent) {
      parentBoxes.push({
        parent: recurrenceParent,
        subtitle: "Execução da recorrência",
        progress: taskProgress(recurrenceParent, recurrenceExecutionsOf(recurrenceParent.id, clientTasks)),
      });
    }
  }

  /** Cards que podem ocupar uma etapa: mesmo cliente, mesmo tipo, mesmo
   * subtipo, e ainda não ligados a esta entrega. Um roteiro já ligado a OUTRA
   * entrega aparece de propósito — compartilhar é o objetivo. E nada de filtrar
   * por status: um card concluído continua associável. */
  function chainCandidates(slot: string) {
    if (!chainDelivery) return [];
    return clientTasks.filter(
      (t) =>
        t.id !== chainDelivery.id &&
        t.client_id === chainDelivery.client_id &&
        t.kind === chainDelivery.kind &&
        t.subtype === slot &&
        !t.parents.some((parent) => parent.id === chainDelivery.id),
    );
  }

  async function linkStepCard(task: TaskRecord, slot: string) {
    if (!chainDelivery) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${chainDelivery.id}/relations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: task.id, slot }),
      });
      const body = await res.json().catch(() => null) as (TaskRecord & { error?: string }) | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível ligar o card.");
      // O card que MUDOU é o filho — ele ganhou um pai novo. Passar a entrega
      // aqui (que não mudou) era o bug: `clientTasks` nunca aprendia o elo, a
      // etapa continuava aparecendo vazia, e um segundo clique criava um
      // segundo elo no mesmo slot.
      if (body?.id) onTaskPatched?.(body as TaskRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível ligar o card.");
    } finally {
      setBusy(false);
    }
  }

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
        setDraft(draftFrom(updated, slug, prefill));
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
  const isNewPlan = mode === "new" && effectiveScope === "plan";
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
    ? newPlanClientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !t.parents.length && !pendingMembers.some((m) => m.kind === "existing" && m.taskId === t.id))
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

  async function saveCommentEdit() {
    if (!liveTask || !editingComment) return;
    const { index, at, text } = editingComment;
    if (!text.trim()) return;
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/comments`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, at, text: text.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      const updated = await res.json() as TaskRecord;
      setEditingComment(null);
      setLiveTask(updated); onTaskPatched?.(updated);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Não foi possível editar o comentário.");
    }
  }

  async function removeComment(index: number, at: string) {
    if (!liveTask) return;
    if (!window.confirm("Excluir este comentário? Não dá para desfazer.")) return;
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/comments`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, at }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      const updated = await res.json() as TaskRecord;
      if (editingComment?.index === index) setEditingComment(null);
      setLiveTask(updated); onTaskPatched?.(updated);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Não foi possível excluir o comentário.");
    }
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
        if (body?.code === "recurrence_ended" && body.parent) {
          // Molde foi para aprovado/parada: a recorrência encerrou. Sincroniza
          // o estado (o botão some) e mostra o motivo.
          setLiveTask(body.parent);
          onTaskPatched?.(body.parent);
          setError(body.error ?? "Esta recorrência foi encerrada.");
          setBusy(false);
          return;
        }
        if (!retried && body?.code === "recurrence_schedule_changed" && body.parent) {
          setLiveTask(body.parent);
          setDraft(draftFrom(body.parent, slug, prefill));
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
    // Dia-da-semana é opcional: sem marcação, o servidor fixa a recorrência no
    // dia da data de início (ver recurrenceWeekdays em lib/recurrence.ts).
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
    if (mode === "new" && effectiveScope === "plan") {
      body.kind = "plano_acao";
    } else if (mode === "new" && effectiveScope === "routine" && !body.recurrence_cadence) {
      body.recurrence_cadence = "semanal";
    }
    // Cliente is editable in edit mode too now — always send it (as the
    // current draft, whether changed or not) so a real change actually moves
    // the card; null explicitly means "sem cliente".
    if (liveTask) body.slug = draft.clientSlug || null;
    try {
      const res = liveTask
        ? await fetch(`/api/admin/tasks/${liveTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/tasks?scope=${effectiveScope}`, {
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

  // A capa do modal usa a descrição do RASCUNHO (não a salva), então colar um
  // link do Drive na descrição mostra a capa na hora, antes de salvar. Os
  // comentários vêm do card salvo — não são editáveis aqui.
  // Memoizado porque isto varre descrição + thread inteira, e rodaria a cada
  // tecla digitada no título.
  const coverCandidates = useMemo(
    () => taskCoverCandidates({ description: draft.description, payload: task?.payload }),
    [draft.description, task?.payload],
  );

  // Pastas do Drive citadas no card. Mesma origem da capa (descrição +
  // comentários), pergunta diferente: onde fica o material, não qual imagem
  // representa. Ver taskDriveFolders.
  const driveFolders = useMemo(
    () => taskDriveFolders({ description: draft.description, payload: task?.payload }),
    [draft.description, task?.payload],
  );

  // -1 quando o card está parado: nenhuma etapa aparece cumprida, que é a
  // leitura certa para um card que travou em vez de avançar.
  const stepIdx = WORKFLOW_ORDER.indexOf(draft.status);

  return (
    <>
    <div className="kb-modal-backdrop" onClick={() => { if (!busy) void closeAfterSave(); }}>
      <div className={`tm tm-tone-${tone} tm-lg`} onClick={(e) => e.stopPropagation()}>
        {coverCandidates.length ? <CardCover candidates={coverCandidates} title={draft.title || "card"} className="tm-cover" /> : null}
        {mode === "edit" ? (
          <div className={`tm-head tm-head-tone-${tone}`}>
            <div className="tm-head-identity">
              {onBack ? <button type="button" className="tm-back" onClick={() => void closeAfterSave(onBack)} aria-label="Voltar para o card anterior" title="Voltar"><BackArrowIcon /></button> : null}
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
                      trigger={<span className="tm-headpick-label"><span className="tm-headpick-ico" aria-hidden>{kindIcon(draft.kind)}</span>{typeLabelOf(draft.kind)}</span>}
                    >
                      {creationTypes.map((type) => (
                        <button type="button" key={type.key} className={`tm-headpick-option ${draft.kind === type.key ? "on" : ""}`} onClick={() => pickKind(type.key)}>
                          <span className="tm-headpick-ico" aria-hidden>{kindIcon(type.key)}</span>{type.label}
                        </button>
                      ))}
                    </HeadDropdown>
                  </>
                ) : null}
                {subtypeOptions.length ? (
                  <>
                    <span className="tm-head-sep">·</span>
                    <HeadDropdown
                      className="tm-headpick-subtype"
                      trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabelOf(draft.subtype) : "Subtipo"}</span>}
                    >
                      <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>— Sem subtipo —</button>
                      {subtypeOptions.map((sub) => (
                        <button type="button" key={sub.key} className={`tm-headpick-option ${draft.subtype === sub.key ? "on" : ""}`} onClick={() => set("subtype", sub.key)}>
                          {sub.label}
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
                    className={`tm-step ${column.status !== "parada" && stepIdx >= 0 && WORKFLOW_ORDER.indexOf(column.status) <= stepIdx ? "done" : ""} ${draft.status === column.status ? "current" : ""} ${column.status === "parada" ? "tm-step-halt" : ""}`}
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
                <div
                  className={`tm-head-progress ${draft.status === "parada" ? "tm-head-progress-halt" : ""}`}
                  title={draft.status === "parada" ? `Parada em ${headerPct}%` : `Progresso ${headerPct}%`}
                >
                  <span><span className="tm-head-progress-fill" style={{ width: `${headerPct}%` }} /></span>
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
                  trigger={<span className="tm-headpick-label"><span className="tm-headpick-ico" aria-hidden>{rotinaMode ? ROTINA_OPTION.icon : kindIcon(draft.kind)}</span>{rotinaMode ? ROTINA_OPTION.label : typeLabelOf(draft.kind)}</span>}
                >
                  {creationTypes.map((type) => {
                    const isRotina = type.key === ROTINA_KEY;
                    const on = isRotina ? rotinaMode : !rotinaMode && draft.kind === type.key;
                    return (
                      <button type="button" key={type.key} className={`tm-headpick-option ${on ? "on" : ""}`} onClick={() => pickKind(type.key)}>
                        <span className="tm-headpick-ico" aria-hidden>{isRotina ? ROTINA_OPTION.icon : kindIcon(type.key)}</span>{type.label}
                        {type.behavior === "entrega" ? <span className="tm-headpick-hint">corrente de etapas</span> : null}
                        {isRotina ? <span className="tm-headpick-hint">se repete sozinha</span> : null}
                      </button>
                    );
                  })}
                </HeadDropdown>
                {subtypeOptions.length ? (
                  <HeadDropdown
                    className="tm-new-kind"
                    trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabelOf(draft.subtype) : currentType?.behavior === "entrega" ? "Fluxo completo" : "Subtipo"}</span>}
                  >
                    {currentType?.behavior === "entrega" ? (
                      // "Fluxo completo" (default) monta a corrente inteira;
                      // escolher uma etapa abaixo cria SÓ aquele card, solto.
                      <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>Fluxo completo</button>
                    ) : (
                      <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>— Sem subtipo —</button>
                    )}
                    {subtypeOptions.map((sub) => (
                      <button type="button" key={sub.key} className={`tm-headpick-option ${draft.subtype === sub.key ? "on" : ""}`} onClick={() => set("subtype", sub.key)}>{sub.label}</button>
                    ))}
                  </HeadDropdown>
                ) : null}
              </div>
              <p className="admin-sub">
                {rotinaMode
                  ? "Uma rotina se repete na cadência escolhida. Cada ciclo nasce como um card próprio."
                  : currentType?.behavior === "entrega"
                    ? (draft.subtype
                        ? `Cria só o card de ${subtypeLabelOf(draft.subtype)}. Pode ser vinculado a uma entrega depois.`
                        : `Nasce em ${currentType.subtypes[0]?.label ?? "primeira etapa"} e cada etapa concluída cria a próxima.`)
                    : currentType?.behavior === "plano"
                      ? "Um plano agrega outras tarefas e mostra o progresso do conjunto."
                      : "Conte o essencial e escolha o tipo do card."}
              </p>
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
                <span className="tm-newclient">{draftClientName}</span>
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
              {!kd.isPlan && !(mode === "new" && effectiveScope === "routine") ? (
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
                  recurrenceRequired={mode === "new" && effectiveScope === "routine"}
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
              {draft.kind === "criativo" ? (
                <Cell icon="◔" label="Plataforma" hidden={!visible("plataforma")}>
                  <select value={draft.plataforma} onChange={(e) => set("plataforma", e.target.value)}>
                    <option value="">—</option>
                    {PLATAFORMA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Cell>
              ) : null}

              {/* Revisor (admin, etapa de Revisão) — só aparece com a etapa
                  ligada em Configurações › Etapas. "Sem revisor" pula a etapa. */}
              <Cell icon="✓" label="Revisor" hidden={revisaoOff}>
                <select value={draft.reviewer_id} onChange={(e) => set("reviewer_id", e.target.value)}>
                  <option value="">— Sem revisor —</option>
                  {adminReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Cell>

              {/* Aprovador (cliente, etapa de Aprovação) — mesma regra. */}
              <Cell icon="✓" label="Aprovador" hidden={aprovacaoOff}>
                <select value={draft.approver_id} onChange={(e) => set("approver_id", e.target.value)}>
                  <option value="">— Sem aprovação —</option>
                  {clientReviewers.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Cell>

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

            {/* Modal de um FILHO: a(s) caixa(s) "Faz parte de", enxutas e só de
                navegação. O stepper editável e o 🔗 ficam do lado da entrega. */}
            {parentBoxes.map((box) => (
              <CardParentBox
                key={box.parent.id}
                parent={box.parent}
                subtitle={box.subtitle}
                progress={box.progress}
                canOpen={Boolean(onOpenRelatedTask) && !busy}
                onOpen={() => void openRelatedTask(box.parent)}
              />
            ))}
            {liveTask && !isDelivery && !kd.isPlan && (flowDeliveryId || planParentId || recurrenceParentId) && parentBoxes.length === 0 ? (
              <div className="tm-box tm-parentbox">
                <p className="tm-box-label">Faz parte de</p>
                <p className="admin-sub" style={{ margin: 0 }}>Carregando card pai…</p>
              </div>
            ) : null}

            {flowNext ? (
              <div className="tm-box tm-flownext">
                <p className="tm-box-label">Próxima etapa criada</p>
                <div className="tm-member-list">
                  <div className="tm-member">
                    <button type="button" className="tm-member-open" onClick={() => void openRelatedTask(flowNext)} disabled={!onOpenRelatedTask || busy}>
                      <TaskKindIcon kind={flowNext.kind} size="sm" />
                      <span className="tm-member-title">{subtypeLabel(flowNext.subtype) || flowNext.title}</span>
                      <span className="tm-member-status">{flowNext.due_date ? `Prazo ${flowNext.due_date}` : "Abrir"}</span>
                      <span className="tm-member-arrow" aria-hidden>↗</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* O stepper editável (com 🔗 nos slots vazios, ✕ nos preenchidos)
                aparece só no card da ENTREGA. Numa etapa, quem quer mexer na
                corrente abre a entrega pela caixa "Faz parte de" acima. */}
            {liveTask && isDelivery ? (
              <FlowStepsBox
                type={deliveryType}
                steps={chainSteps}
                currentTaskId={liveTask.id}
                candidatesFor={chainCandidates}
                busy={busy}
                canOpen={Boolean(onOpenRelatedTask)}
                onOpenStep={(card) => void openRelatedTask(card)}
                onUnlinkStep={(card) => void unlinkMember(card.id, liveTask.id)}
                onLinkStep={(card, slot) => void linkStepCard(card, slot)}
              />
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
                      <CommentText text={draft.description} showLinkPreview />
                    ) : (
                      <span className="tm-desc-placeholder">Objetivo, referência e critério de pronto entram aqui antes de enviar para o quadro.</span>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {error ? <p className="admin-error">{error}</p> : null}

            {/* Materiais do card: a pasta do Drive e os arquivos anexados no
                mesmo bloco, porque respondem à mesma pergunta — "onde está o
                material disto?". Compõem um retângulo só quando há apenas um
                dos dois, e duas colunas quando há os dois. */}
            {mode === "edit" && (driveFolders.length > 0 || taskDocs.length > 0) ? (
              <div className="tm-materials">
                {driveFolders.length > 0 ? <CardDriveFolders folders={driveFolders} /> : null}
                {taskDocs.length > 0 ? (
                  <div className="tm-docs">
                    {taskDocs.map((d) => (
                      <button type="button" key={d.id} className="tm-doc-thumb" title={d.name} aria-label={d.name} onClick={() => setPreviewDoc(d)}>
                        <span className="tm-doc-badge">{fileTypeLabel(d)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {mode === "edit" ? (
            <div className="tm-side">
              {/* Uma linha só: "Criado em <data hora>". Autor e conclusão saíram
                  — quem criou já aparece no primeiro comentário e a conclusão
                  está no status; três linhas de metadado empurravam a conversa
                  para baixo sem responder nada que se perguntasse aqui. */}
              {liveTask?.created_at ? (
                <p className="tm-createdline">
                  <span>Criado em</span>
                  <b>{formatAbsoluteTime(liveTask.created_at)}</b>
                </p>
              ) : null}
              <div className="tm-box tm-commentsbox">
                <p className="tm-box-label">Comentários e atividade</p>
                <div className="tm-comments">
                  {comments.slice().reverse().map((c, i) => {
                    // A thread pode misturar comentários de vários cards da
                    // família (plano + atividades, entrega + etapas). Só os do
                    // card aberto são editáveis, e o índice que o servidor
                    // conhece é o do `payload.comments` DESSE card — casado por
                    // `at` (único por card).
                    const own = c.taskId === liveTask?.id;
                    const storedIndex = own ? ownComments.findIndex((o) => o.at === c.at && o.text === c.text) : -1;
                    const editing = own && editingComment?.index === storedIndex;
                    return (
                      <div className={`tm-comment${editing ? " editing" : ""}`} key={`${c.taskId}-${c.at}-${i}`}>
                        <CommentAvatar comment={c} className="tm-comment-av" />
                        <div className="tm-comment-body">
                          <p className="tm-comment-meta">
                            <b>{c.author}</b>
                            <small>{formatCommentTime(c.at)}</small>
                            {c.edited_at ? <small className="tm-comment-edited">editado</small> : null}
                            {own && storedIndex >= 0 ? (
                              <HeadDropdown className="tm-comment-menu" trigger={<span className="sr-only">Ações do comentário</span>}>
                                <button type="button" className="tm-headpick-option" onClick={() => setEditingComment({ index: storedIndex, at: c.at, text: c.text })}>
                                  <span aria-hidden>✎</span> Editar
                                </button>
                                <button type="button" className="tm-headpick-option danger" onClick={() => void removeComment(storedIndex, c.at)}>
                                  <span aria-hidden>🗑</span> Excluir
                                </button>
                              </HeadDropdown>
                            ) : null}
                          </p>
                          {editing ? (
                            <div className="tm-comment-edit">
                              <AutoGrowTextarea
                                rows={1}
                                autoFocus
                                value={editingComment.text}
                                onChange={(e) => setEditingComment((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveCommentEdit(); }
                                  if (e.key === "Escape") setEditingComment(null);
                                }}
                              />
                              <div className="tm-comment-edit-actions">
                                <button type="button" className="admin-btn ghost" onClick={() => setEditingComment(null)}>Cancelar</button>
                                <button type="button" className={`admin-btn primary tm-btn-${tone}`} onClick={() => void saveCommentEdit()} disabled={!editingComment.text.trim()}>Salvar</button>
                              </div>
                            </div>
                          ) : (
                            <p className="tm-comment-text"><CommentText text={c.text} onLinkClick={openDocForUrl} showLinkPreview /></p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {comments.length === 0 ? <p className="admin-sub" style={{ margin: 0 }}>Nenhum comentário ainda.</p> : null}
                </div>
                <div className="tm-comment-input">
                  <HeadDropdown className="tm-comment-attach" trigger={<span aria-hidden>📎</span>}>
                    {commentDocs.length === 0 ? (
                      <p className="tm-member-search-empty">Nenhum documento para anexar.</p>
                    ) : (
                      commentDocs.map((d) => (
                        <button type="button" key={d.id} className="tm-headpick-option" onClick={() => attachDocToComment(d)}>
                          {d.name}
                        </button>
                      ))
                    )}
                  </HeadDropdown>
                  <AutoGrowTextarea
                    rows={1}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendComment(); }
                    }}
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
            {liveTask?.recurrence_cadence && recurrenceStopped(liveTask.status)
              ? <span className="tm-autosave" title="Mova o card para fora de Aprovado/Parada para retomar">Recorrência encerrada</span>
              : liveTask?.recurrence_cadence
                ? <button className="admin-btn ghost rec-complete" onClick={() => void completeCycle()} disabled={busy || !liveTask?.due_date}>✓ Concluir ciclo</button>
                : null}
            {mode === "new" ? <button className="admin-btn ghost" onClick={() => void closeAfterSave()} disabled={busy}>Cancelar</button> : null}
            {mode === "new" ? <button className={`admin-btn primary tm-btn-${tone}`} onClick={save} disabled={busy || !draft.title.trim()}>
              {busy ? "Salvando…" : currentType?.behavior === "entrega" ? "Criar entrega" : "Criar card"}
            </button> : null}
          </div>
        </footer>
      </div>
    </div>
    {previewDoc ? (
      <DocumentPreviewModal
        doc={previewDoc}
        // Back arrow: dismiss just the PDF layer, back to this card.
        onBack={() => setPreviewDoc(null)}
        // ✕ close: skip past the card entirely, back to wherever it was
        // opened from — same as closing the card itself would.
        onClose={() => { setPreviewDoc(null); void closeAfterSave(); }}
        onChanged={(updated) => {
          setPreviewDoc(updated);
          setAttachableDocs((docs) => docs.map((d) => (d.id === updated.id ? updated : d)));
        }}
      />
    ) : null}
    </>
  );
}
