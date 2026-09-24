"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AttrVisibilityPopover from "./AttrVisibilityPopover";
import CalendarPicker, { type CalendarRecurrence } from "./CalendarPicker";
import AssigneePicker from "./AssigneePicker";
import TaskKindIcon from "./TaskKindIcon";
import FlowStepsBox from "./FlowStepsBox";
import MentionTextarea from "./MentionTextarea";
import StepRow, { type StepPatch } from "./StepRow";
import { formatShortDate } from "./taskDates";
import PlanAddCombobox from "./PlanAddCombobox";
import RecurrenceExecutionCombobox from "./RecurrenceExecutionCombobox";
import { addDaysIso } from "./contentPlan";
import { agencyToday } from "./recurringState";
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
import { BAITA_DRIVE_PLAN_ID, creativeWorkspacesForCard, currentFinalAsset, materialCardsOf, materialCoverCandidates, type CreativeMaterialWorkspace } from "@/lib/cardMaterials";
import CardDriveFolders from "./CardDriveFolders";
import CommentText from "@/app/CommentText";
import { useCurrentAdminUser } from "./CurrentUserContext";
import { familyThreadOf, formatAbsoluteTime, formatCommentTime, splitCommentText, type FamilyComment } from "@/lib/comments";
import type { TaskTypeDef } from "@/lib/taskTypes";
import { TASK_KINDS, TASK_KIND_KEYS, canonicalTaskClassification, kindDef, kindIcon, kindLabel, kindTone, subtypeLabel, taskProgress } from "@/lib/taskCatalog";
import { actionPlanMembersOf, activatedTaskPayload, childrenByParent, currentRecurringExecutionOf, deliveryParentIdsOf, flowStepKeyOf, flowStepsOf, isDeferredTask, isFlowDelivery, planParentIdOf, planParentIdsOf, recurrenceExecutionsOf, recurrenceParentIdOf, recurrenceParentOf, referenceParentIdsOf } from "@/lib/taskRelations";
import { isRecurrenceTemplate, recurrenceCycleOf, recurrenceRevisionOf, recurrenceStopped } from "@/lib/recurrenceState";
import { relevantParentRelationKinds, type ParentRelationKind } from "@/lib/flows/parentBoxes";
import { mirroredParentAssignee, mirroredParentDate, mirroredParentStatus, projectParentStatus } from "@/lib/flows/parentStatus";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import { createCommentIdRegistry } from "./commentIds";
import { deriveRequiresReview } from "@/lib/flows/reviewSkip";
import { responsibilityForSubtype } from "@/lib/flows/responsibilityForSubtype";
import { ROLE_LABEL, REVISOR_LABEL, roleTone } from "@/lib/flows/roleTone";
import { stepRoleOf } from "@/lib/flows/stepRole";
import { fileTypeLabel, isHtmlDocument } from "@/lib/documentFiles";
import type { AdminDocument, ResponsibilityAssignment } from "@/lib/supabase";
import type { ClientFlowFlags, ReviewerCandidate, TaskPriority, TaskRecord, TaskStatus } from "@/lib/validation";
import { useTaskAutosave } from "./useTaskAutosave";
import DocumentPreviewModal from "./documentos/DocumentPreviewModal";
import BackArrowIcon from "./BackArrowIcon";
import CreativeDriveWorkspace from "./CreativeDriveWorkspace";

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
// caminho seguir. Etapas só nascem pelo workflow versionado da Entrega.
export type TaskCreationScope = "task" | "plan" | "routine";

/** Pré-preenchimento opcional que uma tela pode passar — nunca comportamento.
 *  Ex.: o "+" embaixo de uma coluna do quadro abre o modal já com aquele status. */
export type TaskCreationPrefill = { clientSlug?: string; status?: TaskStatus; assignee?: string };

type PendingMember =
  | { key: string; kind: "existing"; taskId: string; title: string }
  // `taskKind` e não `kind`: `kind` já é o discriminante desta união ("existing"
  // / "new"). O tipo do card que vai nascer é outro eixo — e é justamente ele
  // que faltava, o que fazia o mesmo composer criar Entrega quando o plano já
  // existia e Tarefa quando não existia (o sintoma "o mesmo botão dá resultado
  // diferente conforme a tela").
  | { key: string; kind: "new"; taskKind: string; title: string; assignee: string; due_date: string; description?: string };

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
  workflowSteps: [],
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
  responsibilityAssignments = [],
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
  // Equipe & papéis (responsibility_assignments) — quem tem qual
  // responsabilidade, para colorir o dropdown de responsável e o selo de
  // papel nos comentários. Opcional/default vazio: uma tela que ainda não
  // busca isto (ex.: automações) simplesmente não colore nada, sem quebrar.
  responsibilityAssignments?: ResponsibilityAssignment[];
  onTaskPatched?: (task: TaskRecord) => void;
  onOpenRelatedTask?: (task: TaskRecord) => void;
  onBack?: () => void;
  onClose: () => void;
  onSaved: (task: TaskRecord, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, slug, prefill));
  // O id que o campo "Plano de Ação" mostrava quando o formulário foi
  // carregado — não é estado de UI (não precisa re-render), só a referência
  // que o PATCH manda como `plan_id_previous` pra `setTaskPlanLink` saber QUAL
  // elo trocar, sem tocar em outro plano que o card já pertença. Atualizado
  // nos mesmos 3 pontos que recriam `draft` a partir de um TaskRecord.
  const planIdBaselineRef = useRef<string>(task ? planParentIdOf(task) ?? "" : "");
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
  const isRecurringParent = Boolean(liveTask && isRecurrenceTemplate(liveTask));
  const recurrenceParentId = liveTask && !isRecurringParent ? recurrenceParentIdOf(liveTask) : null;
  const [recurrenceParent, setRecurrenceParent] = useState<TaskRecord | null>(() => recurrenceParentOf(recurrenceParentId, clientTasks));
  // Subtipos físicos vêm de task_types. Etapas de Entrega vêm exclusivamente
  // da versão persistida do workflow e nunca são opções de subtipo.
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([]);
  // A ENTREGA é o card ligado a uma versão de workflow; a ETAPA é um filho dela
  // cujo subtipo diz que etapa é.
  const isDelivery = Boolean(liveTask && isFlowDelivery(liveTask));
  const [flowDeliveries, setFlowDeliveries] = useState<TaskRecord[]>([]);
  // A entrega de verdade por trás do card aberto — ela mesma quando o card
  // aberto É a entrega, o pai buscado à parte quando o card aberto é uma
  // etapa. A versão persistida no pai é a autoridade para o contexto
  // ascendente da etapa; a lista e os controles da corrente ficam só nela.
  // Uma etapa compartilhada pode alimentar várias Entregas. Ela não ganha um
  // "primeiro pai" arbitrário: uma única Entrega basta para calcular o resumo
  // ascendente; caso contrário o modal mostra todos os contextos.
  const chainDelivery = isDelivery ? liveTask : flowDeliveries.length === 1 ? flowDeliveries[0] : null;
  // Os Planos de Ação a que este card pertence (pode ser mais de um) — não
  // aparecem no quadro, então quase sempre precisam ser buscados por id
  // (igual às Entregas de fluxo).
  const [planParents, setPlanParents] = useState<TaskRecord[]>([]);
  // A etapa recém-criada pela conclusão desta, devolvida pelo PATCH.
  const [flowNext, setFlowNext] = useState<TaskRecord | null>(null);
  const currentType = taskTypes.find((t) => t.key === draft.kind) ?? null;
  // O que o servidor vai criar, derivado do TIPO escolhido no dropdown — não de
  // uma prop. Rotina (porta sintética) cria molde recorrente; uma Entrega
  // materializa obrigatoriamente a primeira etapa da sua versão.
  const effectiveScope: TaskCreationScope =
    mode !== "new" ? "task"
    : rotinaMode ? "routine"
    : draft.kind === "plano_acao" ? "plan"
    : "task";
  const deliveryType = taskTypes.find((t) => t.key === (chainDelivery?.kind ?? (isDelivery ? liveTask?.kind : null))) ?? null;
  // Índice 1-based da etapa dentro do tipo, para o "2/4". -1 enquanto o
  // vocabulário não chegou, se o subtipo saiu do tipo depois de o card já
  // existir. A posição é resolvida pelo FK workflow_step_id do elo.
  const liveWorkflowStepId = chainDelivery && liveTask
    ? liveTask.parents.find((parent) => parent.id === chainDelivery.id)?.workflow_step_id
    : null;
  const flowStepIndex = deliveryType && liveWorkflowStepId
    ? deliveryType.workflowSteps.findIndex((step) => step.workflow_step_id === liveWorkflowStepId)
    : -1;
  const [comment, setComment] = useState("");
  const [commentAssetIds, setCommentAssetIds] = useState<string[]>([]);
  const [materialWorkspaces, setMaterialWorkspaces] = useState<CreativeMaterialWorkspace[]>([]);
  const [driveOpen, setDriveOpen] = useState<{ taskId: string; assetId?: string } | null>(null);
  const reloadMaterials = useCallback(() => {
    fetch("/api/admin/drive/baita/materials", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { workspaces?: CreativeMaterialWorkspace[] } | null) => { if (data?.workspaces) setMaterialWorkspaces(data.workspaces); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (mode === "edit") reloadMaterials(); }, [mode, reloadMaterials]);
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
  // Um card existente sempre mostra o próprio tipo, mesmo que esteja inativo
  // no catálogo. Etapa de fluxo é uma Tarefa comum e nunca pode parecer um
  // subtipo de Entrega ao abrir o modal.
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
  const subtypeOptions = currentType?.behavior === "entrega" ? [] : currentType?.subtypes ?? [];
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
  // `requires_review` nunca é escrito à mão — é sempre derivado de quem é o
  // revisor e quem são os responsáveis vinculados (lib/flows/reviewSkip.ts),
  // a mesma função usada pelo servidor (fonte de verdade). Zera aqui o
  // reviewer_id já considerando a etapa desligada, para as duas chamadas do
  // save (autosave e save() manual) nunca divergirem entre si.
  const effectiveReviewerId = revisaoOff ? null : draft.reviewer_id || null;
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
      reviewer_id: effectiveReviewerId,
      approver_id: aprovacaoOff ? null : draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      // O elo que ESTE campo representa, pra setTaskPlanLink trocar só ele —
      // ver planIdBaselineRef acima.
      plan_id_previous: kd.isPlan ? null : planIdBaselineRef.current || null,
      requires_review: deriveRequiresReview(effectiveReviewerId, draft.assignee_profile_ids),
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
    // A troca (se houve) já foi confirmada pelo servidor — atualiza a
    // referência pra um próximo autosave saber o elo atual, não o de quando o
    // modal abriu. Sem isto, trocar A→B e depois B→A de novo na mesma sessão
    // não fazia nada na segunda vez: o servidor via plan_id_previous="A" ===
    // plan_id="A" e achava que nada tinha mudado.
    planIdBaselineRef.current = planParentIdOf(task as TaskRecord) ?? "";
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

  // A regra de quem mostra o thread da família mora em lib/comments.ts, para
  // esta tela e o painel lateral responderem a mesma coisa sobre o mesmo card.
  // O tipo vem do RASCUNHO, não do card salvo: trocar o tipo no formulário
  // reflete no thread antes de salvar, como o resto do editor já faz.
  const comments: FamilyComment[] = useMemo(
    () => (liveTask ? familyThreadOf(liveTask, clientTasks, draft.kind) : []),
    [liveTask, clientTasks, draft.kind],
  );
  const ownComments = liveTask ? commentsOf(liveTask) : [];
  // Card de origem de cada comentário da família — para o selo de papel
  // (calculado NA HORA, nunca congelado: lê os dados atuais de reviewer_id/
  // assignee_profile_ids do card, não algo salvo junto do comentário).
  // `clientTasks` já traz `assignee_profile_ids` via join (TASK_COLUMNS_WITH_ASSIGNEES),
  // então nenhuma busca nova é necessária aqui.
  const stepsById = useMemo(() => {
    const map = new Map(clientTasks.map((t) => [t.id, t]));
    if (liveTask) map.set(liveTask.id, liveTask);
    return map;
  }, [clientTasks, liveTask]);
  // Same client first (most relevant), other clients' documents below —
  // never hidden entirely, since a comment can reasonably reference either.
  const commentDocs = draft.clientSlug
    ? [...attachableDocs.filter((d) => d.clientSlug === draft.clientSlug), ...attachableDocs.filter((d) => d.clientSlug !== draft.clientSlug)]
    : attachableDocs;
  // Each source card keeps its own documents. A parent only mirrors their
  // references, so shared stages appear once and routine cycles stay separate.
  const materialCards = useMemo(() => liveTask ? materialCardsOf(liveTask, clientTasks) : [], [liveTask, clientTasks]);
  const materialGroups = useMemo(() => materialCards.map((card) => {
    const byId = new Map(attachableDocs.filter((doc) => doc.task_id === card.id).map((doc) => [doc.id, doc]));
    for (const item of commentsOf(card)) for (const part of splitCommentText(item.text)) {
      if (!("url" in part)) continue;
      const doc = attachableDocs.find((candidate) => candidate.file_url === part.url);
      if (doc) byId.set(doc.id, doc);
    }
    return { card, docs: Array.from(byId.values()) };
  }).filter((group) => group.docs.length), [materialCards, attachableDocs]);
  const cardWorkspaces = useMemo(() => liveTask ? creativeWorkspacesForCard(liveTask, clientTasks, materialWorkspaces) : [], [liveTask, clientTasks, materialWorkspaces]);
  const creativeCandidates = useMemo(() => {
    const candidates = [...materialCards, ...flowDeliveries];
    return Array.from(new Map(candidates.filter((card) => card.kind === "criativo" && !card.subtype && planParentIdsOf(card).includes(BAITA_DRIVE_PLAN_ID)).map((card) => [card.id, card])).values());
  }, [materialCards, flowDeliveries]);
  const visibleCreativeCandidates = creativeCandidates.filter((card) =>
    liveTask?.kind === "criativo" || liveTask?.subtype === "captacao" ||
    cardWorkspaces.some((workspace) => workspace.creative_task_id === card.id && currentFinalAsset(workspace)),
  );
  const commentAssets = useMemo(() => new Map(materialWorkspaces.flatMap((workspace) => workspace.assets.map((asset) => [asset.id, { asset, workspace }] as const))), [materialWorkspaces]);
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
  // Chave idempotente dos comentários pendentes (retry / clique duplo = 1 comentário).
  const commentIds = useRef(createCommentIdRegistry()).current;

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

  // Os elos workflow_step já dizem TODAS as Entregas que consomem esta etapa.
  // Não escolher `parents[0]`: a Diária de gravação é legitimamente N:N.
  const flowDeliveryIds = liveTask && !isDelivery ? deliveryParentIdsOf(liveTask) : [];
  const flowDeliveryIdsKey = flowDeliveryIds.join(",");
  const singleFlowDeliveryId = flowDeliveryIds.length === 1 ? flowDeliveryIds[0] : null;
  useEffect(() => {
    if (!flowDeliveryIds.length) { setFlowDeliveries([]); return; }
    // Só Entrega vira corrente. Um id pode estar fora do quadro normal, então
    // cada pai ausente é buscado em paralelo, sem N+1 serial.
    const asDelivery = (parent: TaskRecord | null) => (parent && isFlowDelivery(parent) ? parent : null);
    let cancelled = false;
    Promise.all(flowDeliveryIds.map((id) => {
      const loaded = clientTasks.find((task) => task.id === id) ?? null;
      if (loaded) return Promise.resolve(loaded);
      return fetch(`/api/admin/tasks/${encodeURIComponent(id)}`)
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null) as Promise<TaskRecord | null>;
    })).then((parents) => {
      if (!cancelled) setFlowDeliveries(parents.map(asDelivery).filter((parent): parent is TaskRecord => Boolean(parent)));
    });
    return () => { cancelled = true; };
  }, [flowDeliveryIdsKey, clientTasks]);

  // O mesmo, para o Plano de Ação a que o card pertence (elo sem slot). Igual à
  // entrega, o plano não aparece no quadro, então o normal é buscar por id.
  //
  // SEM excluir `isDelivery` de propósito (P1-D3): quando o fluxo nasce "por
  // dentro" de um plano, é a ENTREGA que carrega o `plan_id` direto — a rota
  // de criação liga `flow.delivery.id` ao plano, não uma das etapas. Excluir
  // isDelivery aqui era o que fazia o card que É a entrega nunca mostrar "Faz
  // parte de": a caixa de etapas (FlowStepsBox) aparecia, a de plano nunca.
  const planParentIds = liveTask && !isRecurringParent && !kindDef(liveTask.kind).isPlan
    ? planParentIdsOf(liveTask)
    : [];
  const planParentIdsKey = planParentIds.join(",");
  useEffect(() => {
    if (!planParentIds.length) { setPlanParents([]); return; }
    const asPlan = (parent: TaskRecord | null) => (parent && kindDef(parent.kind).isPlan ? parent : null);
    let cancelled = false;
    Promise.all(planParentIds.map((id) => {
      const loaded = clientTasks.find((t) => t.id === id) ?? null;
      if (loaded) return Promise.resolve(loaded);
      return fetch(`/api/admin/tasks/${encodeURIComponent(id)}`)
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null) as Promise<TaskRecord | null>;
    })).then((parents) => {
      if (!cancelled) setPlanParents(parents.map(asPlan).filter((p): p is TaskRecord => Boolean(p)));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planParentIdsKey, clientTasks]);

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
        // Trocar de tipo troca o vocabulário de subtipo. Entrega não recebe
        // subtipo: suas etapas são materializadas pela versão persistida.
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
  // Sem isto, um membro que é ele mesmo um pai (a ocorrência de uma
  // recorrência de Plano, ex. "REUNIÃO ROTINA - ALLAN" — herda o `kind`
  // plano_acao do molde) tinha o PRÓPRIO progresso calculado com uma lista
  // de filhos vazia e sempre voltava 0%, travando a média do molde inteiro
  // perto de 0 não importa quanto trabalho fosse concluído dentro dele.
  // `app/admin/KanbanBoard.tsx` já monta e passa este mapa; faltava aqui.
  const membersByParent = useMemo(() => childrenByParent(clientTasks), [clientTasks]);
  // Unsaved status changes are the task's current UI truth. Reading liveTask
  // here left the percentage frozen until Save, even while the stepper moved.
  const currentRecurringExecution = liveTask && isRecurringParent
    ? currentRecurringExecutionOf(liveTask.id, clientTasks)
    : null;
  const effectiveParentMembers = isRecurringParent
    ? (currentRecurringExecution ? [currentRecurringExecution] : [])
    : planMembers;
  const projectedParentStatus = liveTask && (isDelivery || kd.isPlan || isRecurringParent)
    ? projectParentStatus(liveTask, isDelivery ? flowSteps : effectiveParentMembers, membersByParent)
    : null;
  const progressTask = liveTask ? { ...liveTask, kind: draft.kind, status: projectedParentStatus ?? draft.status } : null;
  const headerPct = progressTask
    ? (isDelivery
        ? taskProgress(progressTask, flowSteps, membersByParent)
        : kd.isPlan || isRecurringParent ? taskProgress(progressTask, effectiveParentMembers, membersByParent) : taskProgress(progressTask))
    : 0;
  // A mesma barra representa contas diferentes conforme o card: numa Entrega
  // é a posição no funil da etapa corrente (inclui etapas que nem nasceram
  // ainda); num Plano/Rotina é a fração de membros concluídos. Um rótulo
  // fixo "Progresso" sugeria que "70%" quer dizer a mesma coisa nos dois —
  // não quer. A contagem ao lado tira a % de ter que ser tomada de fé.
  const headerProgressLabel = isDelivery ? "Progresso do fluxo" : kd.isPlan || isRecurringParent ? "Conclusão" : "Progresso";
  const headerProgressCount = !isDelivery && (kd.isPlan || isRecurringParent) && effectiveParentMembers.length
    ? `${effectiveParentMembers.filter((m) => m.status === "aprovado").length} de ${effectiveParentMembers.length}`
    : null;
  const canCrossClientPlan = Boolean(liveTask && kd.isPlan && draft.clientSlug === "north");
  const canCrossClientRecurrence = Boolean(liveTask && isRecurringParent && draft.clientSlug === "north");
  // Um Plano da ADM North pode reunir card de QUALQUER cliente (permissão já
  // aplicada no servidor — POST /relations e o PATCH de plan_id), mas
  // `clientTasks` é só o que a TELA que abriu o modal já carregou, que nunca
  // inclui outro cliente. Sem isto, o combobox de "vincular card existente"
  // não achava nada pra buscar mesmo quando a permissão já deixava linkar —
  // bug real relatado (2026-09-2x): a permissão funcionava, a busca não tinha
  // com o que trabalhar. Busca o quadro cross-client inteiro (mesma fonte do
  // filtro "Todos", `listAllTasks`) uma vez, só quando este card é
  // efetivamente um Plano da North.
  const [crossClientPool, setCrossClientPool] = useState<TaskRecord[]>([]);
  useEffect(() => {
    if (!canCrossClientPlan) { setCrossClientPool([]); return; }
    let cancelled = false;
    fetch("/api/admin/tasks")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tasks: TaskRecord[] } | null) => { if (!cancelled && data?.tasks) setCrossClientPool(data.tasks); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canCrossClientPlan]);
  const linkCandidatePool = useMemo(() => {
    if (!canCrossClientPlan || !crossClientPool.length) return clientTasks;
    const merged = new Map(clientTasks.map((t) => [t.id, t]));
    for (const t of crossClientPool) if (!merged.has(t.id)) merged.set(t.id, t);
    return [...merged.values()];
  }, [clientTasks, canCrossClientPlan, crossClientPool]);
  const linkableCandidates = liveTask
    // Ter uma entrega como pai não impede entrar num plano, e já pertencer a
    // OUTRO plano também não — um card pode ser membro de vários Planos de
    // Ação ao mesmo tempo. O que continua impedido é oferecer de novo um card
    // que já é membro DESTE plano especificamente.
    ? linkCandidatePool.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !planParentIdsOf(t).includes(liveTask.id) && (canCrossClientPlan || t.client_id === liveTask.client_id))
    : [];
  // Candidatos a "vincular como execução" de um molde de recorrência: mesmo
  // cliente, não pode ser molde de nenhuma recorrência nem já ser execução de
  // NENHUMA — inclusive desta, senão o card vinculado continua aparecendo
  // como opção depois de já estar linkado — mas pode já pertencer a um Plano
  // (mecanismo independente) e pode ser de um `kind` diferente do molde (a UI
  // só ordena o mesmo tipo primeiro, não trava — pedido explícito: precisa
  // aceitar vincular uma Entrega).
  const recurrenceLinkCandidates = liveTask && isRecurringParent
    ? clientTasks.filter((t) => t.id !== liveTask.id && !t.recurrence_cadence && recurrenceParentIdOf(t) === null && (canCrossClientRecurrence || t.client_id === liveTask.client_id) && t.kind === liveTask.kind)
    : [];
  // As etapas são lidas para o próprio card Entrega e para compor o resumo
  // ascendente de uma etapa com uma única Entrega-pai. A lista editável só é
  // renderizada no primeiro caso; `chainDelivery` já traz sua versão persistida.
  const chainSteps = chainDelivery ? flowStepsOf(chainDelivery.id, clientTasks) : [];
  const deliveryClassificationLocked = Boolean(chainDelivery && chainSteps.some((step) => step.status !== "backlog"));

  // As caixas "Faz parte de": uma linha enxuta por card pai (entrega, plano,
  // molde de recorrência), só para navegar. Um card pode ter mais de uma ao
  // mesmo tempo (etapa de uma entrega E atividade de um plano; ou entrega E
  // ocorrência de um fluxo recorrente), daí a lista.
  //
  // QUAIS relações valem para este card vêm de `relevantParentRelationKinds`
  // (lib/flows/parentBoxes.ts, função pura testada) — não são decididas aqui
  // de novo. Antes, esta lista E a condição do placeholder "Carregando card
  // pai…" (mais abaixo) repetiam cada uma a sua própria combinação de flags,
  // e as duas divergiram: a de recorrência excluía `isDelivery` aqui mas não
  // na condição do placeholder, o que deixava uma entrega-ocorrência de fluxo
  // recorrente (versão de workflow + recurrence_parent_id ao mesmo tempo) presa em
  // "Carregando card pai…" para sempre — o id da recorrência existia, mas
  // nenhuma caixa nascia para preenchê-lo. Com as duas nascendo do mesmo
  // `parentSlots`, não tem como voltar a divergir.
  const parentRelationKinds = liveTask ? relevantParentRelationKinds({ isDelivery, isPlan: Boolean(kd.isPlan) }) : [];
  // "plano" fica de fora daqui: ao contrário de entrega/recorrência, que têm
  // no máximo UM pai, um card pode ter vários Planos ao mesmo tempo — vira uma
  // caixa por Plano, montada direto de `planParents` logo abaixo.
  const parentSlotOf = (kind: Exclude<ParentRelationKind, "plano">): { id: string | null; parent: TaskRecord | null; subtitle: string; progress: number } => {
    if (kind === "entrega") {
      // A contagem vem da versão persistida, não de flags no payload.
      const total = deliveryType?.workflowSteps.length ?? 0;
      const stepLabel = liveTask ? subtypeLabelOf(liveTask.subtype ?? "") || "Etapa do fluxo" : "";
      return {
        id: singleFlowDeliveryId,
        parent: chainDelivery,
        subtitle: flowStepIndex >= 0 && total ? `Etapa ${flowStepIndex + 1} de ${total} · ${stepLabel}` : stepLabel,
        progress: chainDelivery ? taskProgress(chainDelivery, chainSteps, membersByParent) : 0,
      };
    }
    return {
      id: recurrenceParentId,
      parent: recurrenceParent,
      subtitle: "Execução da recorrência",
      progress: recurrenceParent
        ? taskProgress(
            recurrenceParent,
            (() => {
              const current = currentRecurringExecutionOf(recurrenceParent.id, clientTasks);
              return current ? [current] : [];
            })(),
            membersByParent,
          )
        : 0,
    };
  };
  const hasPlanKind = parentRelationKinds.includes("plano");
  const entregaSlot = parentRelationKinds.includes("entrega") ? parentSlotOf("entrega") : null;
  const recorrenciaSlot = parentRelationKinds.includes("recorrencia") ? parentSlotOf("recorrencia") : null;
  const planBoxes = hasPlanKind
    ? planParents.map((plan) => ({
        parent: plan,
        relation: "plano" as const,
        subtitle: "Atividade do plano",
        progress: taskProgress(plan, actionPlanMembersOf(plan.id, clientTasks), membersByParent),
    }))
    : [];
  const workflowBoxes = flowDeliveryIds.length > 1
    ? flowDeliveries.map((parent) => ({
        parent,
        relation: "entrega" as const,
        subtitle: "Etapa compartilhada desta entrega",
        progress: taskProgress(parent, flowStepsOf(parent.id, clientTasks), membersByParent),
      }))
    : [];
  // Referências são contexto N:N: aparecem no modal, mas nunca contam como
  // família nem exibem o progresso do outro card como se fosse deste.
  const referenceBoxes = liveTask
    ? referenceParentIdsOf(liveTask)
      .map((id) => clientTasks.find((task) => task.id === id))
      .filter((task): task is TaskRecord => Boolean(task))
      .map((parent) => ({ parent, relation: "referencia" as const, subtitle: "Referência · fora do progresso" }))
    : [];
  // Ordem: pertencimento estrutural, recorrência temporal, depois contexto.
  // UMA caixa "Faz parte de" pra tudo isso junto (entrega + cada Plano +
  // recorrência) — um card que pertence a vários Planos ao mesmo tempo (a
  // agregação da ADM North) listava uma caixa inteira repetida por Plano,
  // cada uma com o mesmo rótulo e a mesma moldura; agora é uma linha por
  // relação dentro da MESMA caixa (ver CardParentBox). Referência continua
  // com rótulo e caixa própria ("Relacionado a") — semântica diferente,
  // fora do rollup da família.
  const belongsToBoxes = [
    ...(entregaSlot?.parent ? [{ parent: entregaSlot.parent, relation: "entrega" as const, subtitle: entregaSlot.subtitle, progress: entregaSlot.progress }] : []),
    ...workflowBoxes,
    ...planBoxes,
    ...(recorrenciaSlot?.parent ? [{ parent: recorrenciaSlot.parent, relation: "recorrencia" as const, subtitle: recorrenciaSlot.subtitle, progress: recorrenciaSlot.progress }] : []),
  ];
  // Um slot cujo id já se conhece mas cujo card pai ainda não chegou (fetch em
  // voo) — o placeholder de carregamento usa isto, e só isto, em vez de
  // recalcular quais relações valem. Para plano, "ainda chegando" é ter mais
  // ids conhecidos do que planos já carregados.
  const pendingParentBox =
    Boolean(entregaSlot?.id && !entregaSlot.parent) ||
    (flowDeliveryIds.length > 1 && flowDeliveries.length < flowDeliveryIds.length) ||
    Boolean(recorrenciaSlot?.id && !recorrenciaSlot.parent) ||
    (hasPlanKind && planParentIds.length > planParents.length);

  /** Cards que podem ocupar uma etapa: mesmo cliente, mesmo task_type_id, e
   * ainda não ligados a esta entrega. Um roteiro já ligado a OUTRA
   * entrega aparece de propósito — compartilhar é o objetivo. E nada de filtrar
   * por status: um card concluído continua associável. */
  function chainCandidates(taskTypeId: string) {
    if (!chainDelivery) return [];
    return clientTasks.filter(
      (t) =>
        t.id !== chainDelivery.id &&
        t.client_id === chainDelivery.client_id &&
        // A etapa é uma Tarefa comum; o FK da etapa versionada é a única
        // autoridade para sua classificação, não o texto em `subtype`.
        t.task_type_id === taskTypeId &&
        // `?? []`: um card que chegou de uma resposta crua da API (ex.: RPC de
        // comentário devolvendo só `t.*`, sem os joins de `mergeTaskAssigneeRow`)
        // não tem `parents` nenhum — sem a guarda isto quebrava a árvore inteira
        // (TypeError: Cannot read properties of undefined) só por comentar um card.
        !(t.parents ?? []).some((parent) => parent.id === chainDelivery.id),
    );
  }

  async function linkStepCard(task: TaskRecord, workflowStepId: string) {
    if (!chainDelivery) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${chainDelivery.id}/relations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: task.id, workflow_step_id: workflowStepId, relation_kind: "workflow_step" }),
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
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId }),
      });
      // Erro engolido em silêncio (2026-09-2x): um card que já tem um Plano
      // "dono" (não-North) recusa um segundo — a resposta vinha 4xx/5xx e o
      // combobox não avisava nada, parecia que o clique não fazia nada.
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "Não foi possível vincular o card.");
        return;
      }
      onTaskPatched?.(await res.json());
    } catch {
      setError("Não foi possível vincular o card.");
    }
  }

  async function linkRecurrenceExecution(taskId: string) {
    if (!liveTask) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/recurrence-executions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: taskId }),
      });
      const body = await res.json().catch(() => null) as (TaskRecord & { error?: string }) | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível vincular esta execução.");
      onTaskPatched?.(body as TaskRecord);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível vincular esta execução.");
    } finally {
      setBusy(false);
    }
  }

  async function linkRecurrenceExecutionAtDate(taskId: string, occurrenceDate: string) {
    if (!liveTask) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/recurrence-executions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "link", child_id: taskId, occurrence_date: occurrenceDate }) });
      const body = await res.json().catch(() => null) as (TaskRecord & { error?: string }) | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível vincular esta execução.");
      onTaskPatched?.(body as TaskRecord);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível vincular esta execução."); } finally { setBusy(false); }
  }

  async function createRecurrenceExecutions(dates: string[], title: string) {
    if (!liveTask) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/recurrence-executions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "create", occurrence_dates: dates, title: title || undefined }) });
      const body = await res.json().catch(() => null) as { tasks?: TaskRecord[]; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Não foi possível criar as execuções.");
      for (const task of body?.tasks ?? []) onTaskPatched?.(task);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar as execuções."); } finally { setBusy(false); }
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
        planIdBaselineRef.current = planParentIdOf(updated) ?? "";
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
    // Mesma guarda de baixo (`?? []`): ver comentário em chainCandidates.
    ? newPlanClientTasks.filter((t) => !kindDef(t.kind).isPlan && !t.recurrence_cadence && !(t.parents ?? []).length && !pendingMembers.some((m) => m.kind === "existing" && m.taskId === t.id))
    : [];
  function addPendingExisting(candidate: { id: string; title: string }) {
    setPendingMembers((current) => [...current, { key: `e-${candidate.id}`, kind: "existing", taskId: candidate.id, title: candidate.title }]);
  }
  function removePendingMember(key: string) {
    setPendingMembers((current) => current.filter((m) => m.key !== key));
  }

  // Same idea for an already-saved plan: creates the activity straight away
  // (instead of queueing) and links it via plan_id in the same request.
  //
  // O `kind` vem de quem chamou (o seletor do PlanMemberComposer), nunca mais
  // cravado em "operacional" — era isso que fazia uma atividade "Entrega"
  // criada por dentro do plano nascer como Tarefa comum, e só quebrar de
  // verdade quando alguém trocava o Tipo depois num PATCH avulso (P0-B: o card
  // ficava com `kind: criativo` mas sem versão de workflow e sem
  // etapa nenhuma). A porta é a mesma do NewTaskButton — POST
  // /api/admin/tasks?scope=task — então um tipo `behavior:'entrega'` já
  // cascateia sozinho (createFlowDelivery), sem lógica nova aqui.
  async function createLinkedActivity(data: { title: string; assignee: string; due_date: string; kind: string; description?: string }) {
    if (!liveTask) return;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      title: data.title,
      description: data.description ?? null,
      kind: data.kind,
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
      // Para um tipo Entrega, a resposta é a PRIMEIRA ETAPA — quem realmente
      // entrou no plano foi a entrega (route.ts liga `flow.delivery.id`, não a
      // etapa), e a resposta do POST não a traz. Sem reler os filhos do plano,
      // a caixa "Atividades do plano" fica sem o membro novo até um reload —
      // o card existe certo no banco, só não aparece na hora.
      const related = await fetch(`/api/admin/tasks?parentId=${encodeURIComponent(liveTask.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (Array.isArray(related?.tasks)) {
        for (const relatedTask of related.tasks as TaskRecord[]) onTaskPatched?.(relatedTask);
      }
    } catch {
      setError("Não foi possível criar a atividade.");
    }
    setBusy(false);
  }

  // Board feeds can be older than a deep link (for example, an Entrega just
  // created in another tab). Fetch direct children for every parent kind so a
  // parent modal never projects an empty family while its current stage exists.
  // This does not put future cards on the Tasks screen; it only completes the
  // modal's local family view.
  useEffect(() => {
    if (!liveTask || (!isFlowDelivery(liveTask) && !kindDef(liveTask.kind).isPlan && !liveTask.recurrence_cadence)) return;
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

  // Edição na linha de uma etapa/atividade (StepRow): o PATCH é no card DELA,
  // o mesmo de abrir e editar — cascata e notificações valem igual. Concluir a
  // etapa pode criar a próxima; ela volta junto e entra no estado da tela.
  async function patchRelatedCard(card: TaskRecord, patch: StepPatch) {
    setError("");
    try {
      const res = await fetch(`/api/admin/tasks/${card.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => null) as (TaskRecord & { flow_next_task?: TaskRecord; error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? "Não foi possível atualizar a etapa.");
      const { flow_next_task: next, ...updated } = body;
      onTaskPatched?.(updated as TaskRecord);
      if (next) onTaskPatched?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a etapa.");
    }
  }

  async function commentRelatedCard(card: TaskRecord, text: string) {
    setError("");
    try {
      // O id da etapa já é o da URL: o comentário vai para ELA, sem heurística.
      const res = await fetch(`/api/admin/tasks/${card.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, comment_id: commentIds.idFor(card.id, text) }),
      });
      if (!res.ok) throw new Error();
      commentIds.settle(card.id, text);
      onTaskPatched?.(await res.json() as TaskRecord);
    } catch {
      setError("Não foi possível comentar na etapa.");
      throw new Error("comment failed");
    }
  }

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
    // /admin/operacao (aba Tarefas) é a tela canônica do quadro — com abas,
    // filtros e o item certo da sidebar; /admin/kanban continua existindo
    // (links antigos, e2e) mas deixou de ser o destino que este botão gera.
    const url = `${window.location.origin}/admin/operacao?task=${id}`;
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

  // Na Entrega só se comenta no pai: o comentário é gravado na etapa aberta AGORA
  // (o servidor decide pela ordem e pelo estado real; ver lib/flows/commentTarget.ts).
  // A tela informa a etapa que mostra como corrente — se ela já avançou, o servidor
  // corrige para a etapa atual. Aqui só se avisa a pessoa de onde o texto vai cair.
  const commentStep = isDelivery ? currentFlowStepOf(flowSteps) : null;
  const commentStepLabel = commentStep && !commentStep.completed_at ? subtypeLabelOf(commentStep.subtype ?? "") || "etapa atual" : null;

  async function sendComment() {
    if (!liveTask || !comment.trim()) return;
    const text = comment.trim();
    const stageTaskId = commentStep?.id ?? null;
    setComment("");
    try {
      const res = await fetch(`/api/admin/tasks/${liveTask.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          comment_id: commentIds.idFor(liveTask.id, text),
          ...(stageTaskId && commentAssetIds.length === 0 ? { stage_task_id: stageTaskId } : {}),
          ...(commentAssetIds.length ? { asset_ids: commentAssetIds } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "");
      commentIds.settle(liveTask.id, text);
      setCommentAssetIds([]);
      const updated = await res.json() as TaskRecord;
      // Comentar no PAI grava na etapa corrente (ver lib/flows/currentStep.ts
      // + a rota) — o servidor pode devolver um card DIFERENTE do que está
      // aberto aqui. Só troca o `liveTask` quando é o mesmo card; senão,
      // empurra a etapa atualizada para o estado do quadro (`clientTasks`) e
      // deixa o thread mesclado (`familyThreadOf`) recalcular a partir dela —
      // sem esta guarda o modal do pai "virava" a etapa assim que alguém
      // comentava, porque `updated` passava a ser o card errado.
      if (updated.id === liveTask.id) setLiveTask(updated);
      onTaskPatched?.(updated);
    } catch (e) { setComment(text); setError(e instanceof Error && e.message ? e.message : "Não foi possível enviar o comentário."); }
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
          planIdBaselineRef.current = planParentIdOf(body.parent) ?? "";
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
      reviewer_id: effectiveReviewerId,
      approver_id: aprovacaoOff ? null : draft.approver_id || null,
      plan_id: kd.isPlan ? null : draft.plan_id || null,
      plan_id_previous: kd.isPlan ? null : planIdBaselineRef.current || null,
      // requires_* são derivados de quem é revisor/aprovador — "Sem
      // revisor"/"Sem aprovação" pula a etapa. Um cliente com a etapa
      // desligada nunca exige, independente do draft; e um revisor que é o
      // ÚNICO responsável vinculado também pula (lib/flows/reviewSkip.ts) —
      // revisar o próprio trabalho não é revisão.
      requires_review: deriveRequiresReview(effectiveReviewerId, draft.assignee_profile_ids),
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
      planIdBaselineRef.current = planParentIdOf(savedTask) ?? "";
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
          // Mesma porta (`?scope=task`) e mesmo `kind` escolhido no composer:
          // um tipo com behavior 'entrega' cascateia sozinho no servidor (ver
          // createFlowDelivery na rota), exatamente como quando o plano já
          // existia. Antes isto cravava "operacional", e era o último lugar
          // onde a regra "uma porta só de criação" ainda não valia.
          const memberBody: Record<string, unknown> = {
            title: member.title,
            description: member.description ?? null,
            kind: member.taskKind,
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
    () => {
      const promoted = liveTask && (liveTask.kind === "criativo" || kindDef(liveTask.kind).isPlan)
        ? materialCoverCandidates(cardWorkspaces) : [];
      const previous = taskCoverCandidates({ description: draft.description, payload: task?.payload });
      const seen = new Set(promoted.map((candidate) => candidate.fileId));
      return [...promoted, ...previous.filter((candidate) => !seen.has(candidate.fileId))];
    },
    [cardWorkspaces, draft.description, liveTask, task?.payload],
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
  // O status que o CABEÇALHO mostra. Para um card comum é o do rascunho; para
  // uma ENTREGA é o espelho da etapa corrente (lib/flows/parentStatus.ts).
  //
  // A entrega não é arrastada por ninguém — o status dela na coluna `status` é
  // só a projeção dos descendentes (pai e primeira etapa nascem em Entrada).
  // Sem essa leitura a interface congelava enquanto as etapas andavam, e era
  // isso que fazia o card pai mentir: roteiro em revisão, pai em Entrada.
  // Espelhado, e não persistido, pelo mesmo motivo do progresso — ver o
  // comentário de `mirroredParentStatus`.
  //
  // A entrega também não tem DATA nem RESPONSÁVEL próprios — resolve a etapa
  // corrente UMA VEZ aqui e lê os três espelhos dela, em vez de cada campo
  // varrer `chainSteps` de novo por conta própria.
  const currentChainStep = isDelivery ? currentFlowStepOf(chainSteps) : null;
  const mirroredStatus = mirroredParentStatus(currentChainStep);
  const mirroredDate = mirroredParentDate(currentChainStep);
  const mirroredAssignee = mirroredParentAssignee(currentChainStep);
  const displayStatus = projectedParentStatus ?? mirroredStatus ?? draft.status;
  // Só um card que tem status PRÓPRIO pode ter o status trocado pelo stepper.
  // Numa entrega espelhada, clicar ali escreveria na coluna do pai um valor
  // que a próxima etapa a mudar sobrescreveria na tela — um controle que não
  // controla nada.
  const stepperEditable = projectedParentStatus === null && mirroredStatus === null;
  const stepIdx = WORKFLOW_ORDER.indexOf(displayStatus);

  // Cor por papel no dropdown de responsável: o subtipo relevante é o da
  // etapa corrente (se for entrega, espelhando o resto) ou o próprio subtipo
  // do card (se for uma etapa comum). Sem responsabilidade cadastrada pro
  // subtipo (ex.: publicacao, ou um card fora do funil de criativo),
  // `accountTone` fica undefined e o AssigneePicker não colore nada — a lista
  // de candidatos continua sem restrição nenhuma, é só decoração.
  const relevantSubtype = isDelivery ? currentChainStep?.subtype ?? null : draft.subtype;
  const relevantResponsibility = responsibilityForSubtype(relevantSubtype);
  const accountTone = useMemo(() => {
    if (!relevantResponsibility) return undefined;
    const holders = new Set(
      responsibilityAssignments.filter((a) => a.responsibility === relevantResponsibility).map((a) => a.profile_id),
    );
    return (id: string) => (holders.has(id) ? roleTone(relevantResponsibility) : undefined);
  }, [responsibilityAssignments, relevantResponsibility]);
  const openWorkspace = driveOpen ? materialWorkspaces.find((workspace) => workspace.creative_task_id === driveOpen.taskId) : null;
  const driveTargets = openWorkspace ? Array.from(new Map([
    ...materialWorkspaces.filter((workspace) => workspace.capture_task_id === openWorkspace.capture_task_id).map((workspace) => [workspace.creative_task_id, clientTasks.find((card) => card.id === workspace.creative_task_id)?.title ?? "Criativo"] as const),
    ...creativeCandidates.filter((card) => flowStepsOf(card.id, clientTasks).some((step) => step.id === openWorkspace.capture_task_id)).map((card) => [card.id, card.title] as const),
  ])).map(([id, title]) => ({ id, title }))
    : creativeCandidates.filter((card) => liveTask?.id === card.id || !isDelivery).map((card) => ({ id: card.id, title: card.title }));

  return (
    <>
    <div className="kb-modal-backdrop" onClick={() => { if (!busy) void closeAfterSave(); }}>
      <div className={`tm tm-tone-${tone} tm-lg${mode === "new" ? " tm-new" : ""}`} onClick={(e) => e.stopPropagation()}>
        {coverCandidates.length ? <CardCover key={coverCandidates[0].fileId} candidates={coverCandidates} title={draft.title || "card"} className="tm-cover" /> : null}
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
                {visible("kind") && !isDelivery ? (
                  <>
                    <span className="tm-head-sep">·</span>
                    <HeadDropdown
                      className="tm-headpick-kind"
                      trigger={<span className="tm-headpick-label"><span className="tm-headpick-ico" aria-hidden>{kindIcon(draft.kind)}</span>{typeLabelOf(draft.kind)}</span>}
                    >
                      {creationTypes.map((type) => (
                        <button type="button" key={type.key} className={`tm-headpick-option ${draft.kind === type.key ? "on" : ""}`} onClick={() => pickKind(type.key)} disabled={deliveryClassificationLocked}>
                          <span className="tm-headpick-ico" aria-hidden>{kindIcon(type.key)}</span>{type.label}
                        </button>
                      ))}
                    </HeadDropdown>
                  </>
                ) : null}
                {isDelivery ? (
                  // O card da ENTREGA não ocupa slot nenhum — ele É a soma das
                  // etapas ("Criativo" agregado = roteiro + captação + edição +
                  // publicação), então o seletor de Subtipo não fazia sentido
                  // aqui: escolher uma etapa nele não move nada na corrente, só
                  // reescrevia um campo que o card pai não usa. Bug relatado
                  // (P1-D2): nada na tela avisava que este card É o pai —
                  // mostrava só "Subtipo" vazio, igual a qualquer card comum.
                  <>
                    <span className="tm-head-sep">·</span>
                    {deliveryClassificationLocked ? (
                      <span className="tm-headpick-label tm-head-parentflag" title="Tipo bloqueado após a primeira etapa sair de Entrada.">
                        <span aria-hidden>✦</span> Entrega · <span aria-hidden>{kindIcon(draft.kind)}</span> {typeLabelOf(draft.kind)}
                      </span>
                    ) : (
                      <HeadDropdown
                        className="tm-headpick-kind"
                        trigger={<span className="tm-headpick-label tm-head-parentflag"><span aria-hidden>✦</span> Entrega · <span aria-hidden>{kindIcon(draft.kind)}</span> {typeLabelOf(draft.kind)}</span>}
                      >
                        {creationTypes.filter((type) => type.behavior === "entrega").map((type) => (
                          <button type="button" key={type.key} className={`tm-headpick-option ${draft.kind === type.key ? "on" : ""}`} onClick={() => pickKind(type.key)}>
                            <span className="tm-headpick-ico" aria-hidden>{kindIcon(type.key)}</span>{type.label}
                          </button>
                        ))}
                      </HeadDropdown>
                    )}
                  </>
                ) : subtypeOptions.length ? (
                  <>
                    <span className="tm-head-sep">·</span>
                    <HeadDropdown
                      className="tm-headpick-subtype"
                      trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabelOf(draft.subtype) : "Subtipo"}</span>}
                    >
                      <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")} disabled={deliveryClassificationLocked}>— Sem subtipo —</button>
                      {subtypeOptions.map((sub) => (
                        <button type="button" key={sub.key} className={`tm-headpick-option ${draft.subtype === sub.key ? "on" : ""}`} onClick={() => set("subtype", sub.key)} disabled={deliveryClassificationLocked}>
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
                    className={`tm-step ${column.status !== "parada" && stepIdx >= 0 && WORKFLOW_ORDER.indexOf(column.status) <= stepIdx ? "done" : ""} ${displayStatus === column.status ? "current" : ""} ${column.status === "parada" ? "tm-step-halt" : ""}`}
                    onClick={() => { if (stepperEditable) set("status", column.status); }}
                    disabled={!stepperEditable}
                    title={stepperEditable ? undefined : "O status da entrega espelha a etapa corrente — mova a etapa, não o pai."}
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
                  title={draft.status === "parada" ? `Parada em ${headerPct}%` : `${headerProgressLabel} ${headerPct}%`}
                >
                  <span className="tm-head-progress-label">{headerProgressLabel}{headerProgressCount ? ` · ${headerProgressCount}` : ""}</span>
                  <span className="tm-head-progress-row">
                    <span><span className="tm-head-progress-fill" style={{ width: `${headerPct}%` }} /></span>
                    <b>{headerPct}%</b>
                  </span>
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
                    trigger={<span className="tm-headpick-label">{draft.subtype ? subtypeLabelOf(draft.subtype) : "Subtipo"}</span>}
                  >
                    <button type="button" className={`tm-headpick-option ${!draft.subtype ? "on" : ""}`} onClick={() => set("subtype", "")}>— Sem subtipo —</button>
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
                    ? `Nasce com ${currentType.workflowSteps[0]?.label ?? "a primeira etapa"} em Entrada; as próximas seguem os gatilhos da versão.`
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
              {/* Vínculo com plano (não para o próprio plano). Controle de
                  valor único: um card pode estar em mais de um Plano ao mesmo
                  tempo (a caixa "Faz parte de" mostra todos), mas este campo só
                  representa UM — o que `planIdBaselineRef` guardou quando o
                  card foi carregado. Trocar ou limpar mexe só NESSE elo;
                  qualquer outro plano que o card já pertença fica intacto
                  (bug real até 2026-09-2x: limpar aqui soltava todos de uma
                  vez — ver setTaskPlanLink). */}
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
                {isDelivery ? (
                  // A entrega não tem data própria — espelha a etapa
                  // corrente, mesmo princípio de mirroredStatus acima.
                  <span className="tm-cell-static">
                    {mirroredDate?.start_date || mirroredDate?.due_date
                      ? [mirroredDate.start_date ?? mirroredDate.due_date, mirroredDate.end_date].filter(Boolean).join(" – ")
                      : "Sem etapa"}
                  </span>
                ) : (
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
                )}
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
                {/* A entrega não tem responsável próprio — espelha o(s) da
                    etapa corrente, somente leitura (mesmo princípio do
                    Status/Data acima). accountTone colore por papel de
                    Equipe & papéis nos dois modos. */}
                <AssigneePicker
                  assignee={isDelivery ? mirroredAssignee?.assignee ?? null : draft.assignee}
                  assigneeProfileIds={isDelivery ? mirroredAssignee?.assigneeProfileIds ?? [] : draft.assignee_profile_ids}
                  accountOptions={adminReviewers}
                  freeTextOptions={assignees}
                  onChange={({ assignee, assigneeProfileIds }) =>
                    setDraft((current) => ({ ...current, assignee: assignee ?? "", assignee_profile_ids: assigneeProfileIds }))
                  }
                  disabled={busy}
                  readOnly={isDelivery}
                  accountTone={accountTone}
                />
              </Cell>

              <Cell icon="⚑" label="Status" hidden={!visible("status")}>
                <span className="tm-cell-static">{STATUS_LABEL[displayStatus]}</span>
              </Cell>
              <Cell icon="⚑" label="Prioridade" hidden={!visible("priority")}>
                <select value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Cell>

            </div>

            {/* A(s) caixa(s) "Faz parte de", enxutas e só de navegação — de uma
                ETAPA (aponta pra entrega) e/ou de QUALQUER card ligado a um
                Plano de Ação, incluindo a própria ENTREGA (P1-D3: o elo do
                plano mora nela quando o fluxo nasce "por dentro" do plano).
                Renderiza ANTES da caixa de Etapas de propósito — plano em
                cima, etapas abaixo, quando os dois existem no mesmo card. O
                stepper editável e o 🔗 ficam do lado da entrega. */}
            <CardParentBox
              label="Faz parte de"
              items={belongsToBoxes}
              canOpen={Boolean(onOpenRelatedTask) && !busy}
              onOpen={(parent) => void openRelatedTask(parent)}
            />
            <CardParentBox
              label="Relacionado a"
              items={referenceBoxes}
              canOpen={Boolean(onOpenRelatedTask) && !busy}
              onOpen={(parent) => void openRelatedTask(parent)}
            />
            {/* Deriva de `pendingParentBox` (mesmos slots que geram as caixas
                acima, entrega/plano(s)/recorrência) — não repete a
                combinação de flags aqui. */}
            {pendingParentBox ? (
              <div className="tm-box tm-parentbox">
                <p className="tm-box-label">Faz parte de</p>
                <p className="admin-sub" style={{ margin: 0 }}>Carregando relação…</p>
              </div>
            ) : null}

            {/* A próxima etapa é irmã da etapa que acabou de avançar. Ela só
                pode aparecer na Entrega operacional, nunca numa etapa nem no
                molde de recorrência, que lista somente suas execuções. */}
            {isDelivery && !isRecurringParent && flowNext ? (
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

            {/* A sequência é contexto e controle exclusivos da Entrega
                operacional. O molde recorrente mostra somente suas execuções;
                cada execução abre como Entrega e mostra as próprias etapas.
                Uma etapa vê somente as caixas ascendentes "Faz parte de" —
                inclusive todas as Entregas legítimas quando for compartilhada
                — e nunca a lista, editor ou comentários de seus irmãos. */}
            {liveTask && isDelivery && !isRecurringParent ? (
              <FlowStepsBox
                type={deliveryType}
                steps={chainSteps}
                currentTaskId={liveTask.id}
                candidatesFor={chainCandidates}
                busy={busy}
                canOpen={Boolean(onOpenRelatedTask)}
                team={adminReviewers}
                onOpenStep={(card) => void openRelatedTask(card)}
                onUnlinkStep={(card) => void unlinkMember(card.id, liveTask.id)}
                onLinkStep={(card, workflowStepId) => void linkStepCard(card, workflowStepId)}
                onPatchStep={patchRelatedCard}
                onCommentStep={commentRelatedCard}
              />
            ) : null}

            {((kd.isPlan || isRecurringParent) && liveTask) || isNewPlan ? (
              <div className={`tm-box tm-planmembers${isRecurringParent ? " tm-cycles" : ""}`}>
                <div className="tm-box-head">
                  <p className="tm-box-label">
                    {isRecurringParent ? "Execuções da recorrência" : "Atividades do plano"} ({liveTask ? planMembers.length : pendingMembers.length})
                    {!isRecurringParent && liveTask && planMembers.length ? (
                      <span className="tm-box-label-sub"> · {effectiveParentMembers.filter((m) => m.status === "aprovado").length} concluídas</span>
                    ) : null}
                  </p>
                  {isRecurringParent && liveTask ? (
                    recurrenceStopped(liveTask.status) ? (
                      <span className="tm-cycles-stopped" title="Mova o card para fora de Aprovado/Parada para retomar">Recorrência encerrada</span>
                    ) : (
                      <div className="tm-cycles-action">
                        {liveTask.due_date ? <span>Próxima entrega <b>{formatShortDate(liveTask.due_date)}</b></span> : null}
                        <button type="button" className={`admin-btn primary tm-btn-${tone} rec-complete`} onClick={() => void completeCycle()} disabled={busy || !liveTask.due_date}>
                          ✓ Concluir ciclo
                        </button>
                      </div>
                    )
                  ) : null}
                </div>
                <div className="tm-member-list">
                  {liveTask ? (
                    planMembers.map((m) => (
                      <StepRow
                        key={m.id}
                        card={m}
                        label={isDeferredTask(m) ? `${m.title} · futura` : m.title}
                        team={adminReviewers}
                        busy={busy}
                        canOpen={Boolean(onOpenRelatedTask)}
                        onOpen={() => void openRelatedTask(m)}
                        onUnlink={() => void unlinkMember(m.id, liveTask.id)}
                        unlinkTitle={isRecurringParent ? `Remover ligação com ${m.title}` : `Desvincular ${m.title} do plano`}
                        lockDateWhenDone={isRecurringParent}
                        onPatch={patchRelatedCard}
                        onComment={commentRelatedCard}
                      />
                    ))
                  ) : (
                    pendingMembers.map((m) => (
                      <div className="tm-member" key={m.key}>
                        <button type="button" className="tm-member-unlink" title="Remover" aria-label={`Remover ${m.title}`} onClick={() => removePendingMember(m.key)}>✕</button>
                        <span className="tm-member-open tm-member-pending">
                          {/* O ícone do tipo que a pessoa escolheu — antes era
                              sempre o de Tarefa, e a fila mostrava um ✦ Entrega
                              disfarçado de ⚙ Tarefa até o plano ser salvo. */}
                          <TaskKindIcon kind={m.kind === "new" ? m.taskKind : "operacional"} size="sm" />
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
                {isRecurringParent && liveTask ? (
                  // O check de um ciclo não é mais um log à parte
                  // (`payload.cycle_log`), que podia mostrar uma data
                  // diferente da do card real daquele ciclo (era o bug
                  // original: "Checks" e "Execuções" divergiam). Concluída,
                  // a PRÓPRIA linha trava a data (StepRow, `lockDateWhenDone`)
                  // — o card concluído com data travada É o check, aqui
                  // nesta caixa. Abrir a execução (card filho) continua
                  // liberando a data normalmente.
                  !recurrenceStopped(liveTask.status) ? (
                    <RecurrenceExecutionCombobox
                      candidates={recurrenceLinkCandidates}
                      templateKind={liveTask.kind}
                      busy={busy}
                      onLink={(c, date) => void linkRecurrenceExecutionAtDate(c.id, date)}
                      onCreate={(dates, title) => void createRecurrenceExecutions(dates, title)}
                    />
                  ) : null
                ) : (
                  <PlanAddCombobox
                    candidates={liveTask ? linkableCandidates : newPlanCandidates}
                    // O MESMO vocabulário nos dois casos — plano já salvo ou
                    // ainda não. Com o plano salvo o card nasce na hora
                    // (createLinkedActivity); sem ele o membro fica numa fila
                    // local e nasce em `save()`, pela mesma rota e com o mesmo
                    // `kind`.
                    types={taskTypes.filter((t) => t.creatable && t.behavior !== "plano")}
                    defaultType={taskTypes.find((t) => t.key === "operacional")?.key ?? taskTypes[0]?.key ?? "operacional"}
                    busy={busy}
                    contextHint={[
                      draft.assignee ? `Nascem com ${draft.assignee}` : "Nascem sem responsável",
                      `prazo a partir de ${formatShortDate(draft.start_date || draft.due_date || agencyToday())}`,
                    ].join(" · ")}
                    onLinkExisting={(c) => { if (liveTask) void linkMember(c.id, liveTask.id); else addPendingExisting(c); }}
                    onCreate={(items) => {
                      const base = draft.start_date || draft.due_date || agencyToday();
                      const rows = items.map((item) => ({
                        title: item.title,
                        description: item.description,
                        kind: item.kind,
                        assignee: draft.assignee,
                        due_date: item.offsetDays !== undefined ? addDaysIso(base, item.offsetDays) : draft.start_date || draft.due_date || "",
                      }));
                      if (liveTask) {
                        void (async () => {
                          for (const row of rows) await createLinkedActivity(row);
                        })();
                        return;
                      }
                      setPendingMembers((current) => [
                        ...current,
                        ...rows.map(({ kind, ...row }, index) => ({ key: `n-${Date.now()}-${index}`, kind: "new" as const, taskKind: kind, ...row })),
                      ]);
                    }}
                  />
                )}
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

            {/* Descrição vazia não ocupa uma caixa inteira com um texto de
                instrução: vira um link que abre o campo. */}
            {mode === "edit" && !draft.description && !editingDescription ? (
              <button type="button" className="tm-desc-add" onClick={() => setEditingDescription(true)}>+ Adicionar descrição</button>
            ) : null}
            {mode === "edit" && (draft.description || editingDescription) ? (
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
            {mode === "edit" && (driveFolders.length > 0 || materialGroups.length > 0 || visibleCreativeCandidates.length > 0) ? (
              <section className="tm-materials" aria-label="Materiais do card">
                <p className="tm-box-label">Materiais</p>
                <div className="tm-material-list">
                  {driveFolders.length > 0 ? <CardDriveFolders folders={driveFolders} /> : null}
                  {materialGroups.map(({ card, docs }) => <div className="tm-material-group" key={card.id}>
                    {card.id !== liveTask?.id ? <small className="tm-material-origin">{card.title}</small> : null}
                    {docs.map((doc) => <button type="button" key={doc.id} className="tm-material-item" title={doc.name} onClick={() => setPreviewDoc(doc)}><span className="tm-material-icon pdf">{fileTypeLabel(doc)}</span><span className="tm-material-name">{doc.name}</span><small>{card.id === liveTask?.id ? "Neste card" : card.title}</small></button>)}
                  </div>)}
                  {visibleCreativeCandidates.map((creative) => {
                    const workspace = cardWorkspaces.find((item) => item.creative_task_id === creative.id);
                    const final = workspace?.final_versions.find((version) => version.state === "current");
                    const finalAsset = workspace?.assets.find((asset) => asset.id === final?.asset_id);
                    const count = (workspace?.raw_links.length ?? 0) + (workspace?.assets.filter((asset) => asset.state === "active" && asset.role !== "raw").length ?? 0);
                    const showRawCount = liveTask?.kind === "criativo" || liveTask?.subtype === "captacao";
                    const rawLabel = workspace?.available_raw_count == null ? "Drive indisponível" : `${workspace.available_raw_limited ? "≥" : ""}${workspace.available_raw_count} brutos`;
                    const materialCount = `${count} ${count === 1 ? "material" : "materiais"}`;
                    const detail = finalAsset ? `Final v${final?.version_number} · ${materialCount}` : showRawCount && workspace ? `${rawLabel} · ${materialCount}` : materialCount;
                    return <button type="button" key={creative.id} className="tm-material-item" onClick={() => setDriveOpen({ taskId: creative.id })}><span className="tm-material-icon folder">▣</span><span className="tm-material-name">{creative.title}</span><small>{detail}</small></button>;
                  })}
                </div>
              </section>
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
                    // Papel de quem comentou NO CARD ONDE O COMENTÁRIO CAIU —
                    // não no card aberto agora. Recalculado a cada render, a
                    // partir do estado atual (nunca congelado no comentário).
                    const originStep = stepsById.get(c.taskId) ?? null;
                    const role = originStep && c.author_id
                      ? stepRoleOf(originStep, new Set(originStep.assignee_profile_ids), c.author_id)
                      : null;
                    const roleLabel = role?.kind === "revisor" ? REVISOR_LABEL : role?.responsibility ? ROLE_LABEL[role.responsibility] : null;
                    const roleClass = role?.kind === "revisor" ? "t-tone-neutral" : role?.responsibility ? roleTone(role.responsibility) : null;
                    const destinationLabel = !own && originStep ? subtypeLabel(originStep.subtype) || originStep.title : null;
                    return (
                      <div className={`tm-comment${editing ? " editing" : ""}`} key={`${c.taskId}-${c.at}-${i}`}>
                        <CommentAvatar comment={c} className="tm-comment-av" />
                        <div className="tm-comment-body">
                          <p className="tm-comment-meta">
                            <b>{c.author}</b>
                            {roleLabel ? <span className={`kb-type ${roleClass}`}>{roleLabel}</span> : null}
                            {destinationLabel ? <small className="tm-comment-origin" title="Onde este comentário foi gravado">→ {destinationLabel}</small> : null}
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
                          {c.asset_ids?.length ? <div className="tm-comment-assets">{c.asset_ids.map((id) => {
                            const found = commentAssets.get(id);
                            if (!found || found.asset.state === "trashed") return null;
                            return <button type="button" key={id} className="tm-comment-asset" title={found.asset.name} onClick={() => setDriveOpen({ taskId: found.workspace.creative_task_id, assetId: id })}>
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
                  <MentionTextarea
                    value={comment}
                    onChange={setComment}
                    onSubmit={() => void sendComment()}
                    placeholder={commentStepLabel ? `Comentar em "${commentStepLabel}"… use @ para chamar alguém` : "Escrever comentário… use @ para chamar alguém"}
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
    {driveOpen ? <CreativeDriveWorkspace
      key={driveOpen.taskId}
      taskId={driveOpen.taskId}
      targets={driveTargets}
      summaries={materialWorkspaces}
      initialAssetId={driveOpen.assetId}
      selectedAssetIds={commentAssetIds}
      onSelectedAssetIdsChange={setCommentAssetIds}
      onChanged={reloadMaterials}
      onBack={() => setDriveOpen(null)}
      onClose={() => { setDriveOpen(null); void closeAfterSave(); }}
    /> : null}
    </>
  );
}
