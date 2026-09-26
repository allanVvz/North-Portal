"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CardModalLauncher from "../CardModalLauncher";
import NewTaskButton from "../NewTaskButton";
import SortMenu from "../SortMenu";
import TaskKindIcon from "../TaskKindIcon";
import { DEADLINE_LABEL, deadlineStateOf } from "../deadlineState";
import { STATUS_LABEL } from "../kanbanShared";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import { sortItems } from "../taskSort";
import { useSortPref } from "../taskSortPrefs";
import { agencyToday } from "../recurringState";
import { normalizeSearchText, taskSearchText } from "@/lib/taskSearch";
import { subtypeLabel } from "@/lib/taskCatalog";
import PlanSearchBar from "./PlanSearchBar";
import CreativeFeedView from "./CreativeFeedView";
import StrategicPlanDeliveriesView from "./StrategicPlanDeliveriesView";
import { hydratePlanDeliveries } from "./strategicTree";
import { isRecurrenceTemplate } from "@/lib/recurrenceState";
import type { ActionPlan, FlowDelivery, ParentCard } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";

type View = "lista" | "estrategica" | "feed";
type EditingTarget = { task: TaskRecord; clientName: string; clientSlug: string; relatedTasks: TaskRecord[]; parentTask?: TaskRecord };

function matches(parent: ParentCard, query: string) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const collect = (card: ParentCard | TaskRecord): string[] => [
    taskSearchText(card, { clientName: parent.clientName, typeLabel: "typeLabel" in card ? card.typeLabel : undefined }),
    ...(("activities" in card ? card.activities : []) as TaskRecord[]).flatMap(collect),
  ];
  const haystack = collect(parent).join(" ");
  return terms.every((term) => haystack.includes(term));
}

function asTask(card: ParentCard): TaskRecord {
  const { clientName: _clientName, clientSlug: _clientSlug, typeLabel: _typeLabel, progress: _progress, activities: _activities, ...task } = card;
  return task;
}

function deepLinkTarget(parent: ParentCard, id: string): EditingTarget | null {
  if (parent.id === id) return { task: asTask(parent), clientName: parent.clientName, clientSlug: parent.clientSlug, relatedTasks: parent.activities };
  for (const child of parent.activities) {
    if (child.id === id) return { task: child, clientName: parent.clientName, clientSlug: parent.clientSlug, relatedTasks: parent.activities, parentTask: asTask(parent) };
    // A Entrega hidratada traz as próprias etapas. Ao abrir uma etapa, o
    // vínculo exibido deve ser a Entrega, não o Plano que a referencia.
    if ("activities" in child) {
      const nested = deepLinkTarget(child as ParentCard, id);
      if (nested) return nested;
    }
  }
  return null;
}

function ParentColumn({
  title,
  cards,
  empty,
  openIds,
  onToggle,
  onOpen,
  onOpenChild,
  today,
}: {
  title: "Planos" | "Entregas";
  cards: ParentCard[];
  empty: string;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (card: ParentCard) => void;
  onOpenChild: (card: ParentCard, childId: string) => void;
  today: string;
}) {
  return (
    <section className="parent-column" aria-labelledby={`parent-column-${title.toLowerCase()}`}>
      <header className="parent-column-head"><h2 id={`parent-column-${title.toLowerCase()}`}>{title}</h2><span>{cards.length}</span></header>
      {cards.length === 0 ? <p className="admin-empty parent-column-empty">{empty}</p> : (
        <div className="plan-acc">
          {cards.map((card) => {
            const open = openIds.has(card.id);
            const state = card.completed_at ? "concluida" : deadlineStateOf(card, today);
            const current = card.workflow_version_id ? currentFlowStepOf(card.activities) : null;
            return (
              <article className={`plan-acc-item is-${state} ${open ? "open" : ""}`} key={card.id}>
                <div className="plan-acc-head">
                  <button type="button" className="plan-acc-caret-btn" onClick={() => onToggle(card.id)} aria-label={open ? "Recolher" : "Expandir"}>
                    <span className={`plan-acc-caret ${open ? "on" : ""}`}>▸</span>
                  </button>
                  <button type="button" className="plan-acc-title" onClick={() => onOpen(card)}>
                    <span className="plan-acc-tags"><span className="parent-kind-badge">{title === "Planos" ? "Plano" : "Entrega"}</span><span className={`kb-situacao s-${state}`}>{DEADLINE_LABEL[state]}</span></span>
                    <span className="plan-card-titleline"><TaskKindIcon kind={card.kind} /><strong>{card.title}</strong></span>
                    <em>{card.clientName}{current ? ` · ${subtypeLabel(current.subtype) || current.title} · ${STATUS_LABEL[current.status]}` : ""}</em>
                    {card.description ? <span className="plan-acc-description">{card.description}</span> : null}
                  </button>
                  <span className="plan-acc-progress"><span className="plan-acc-bar"><span className="plan-acc-fill" style={{ width: `${card.progress}%` }} /></span><b>{card.progress}%</b></span>
                </div>
                {open ? <div className="plan-acc-body">
                  {card.activities.length ? <ul className="plan-acc-list">{card.activities.map((activity) => (
                    <li key={activity.id}><button type="button" className="plan-acc-actrow" onClick={() => onOpenChild(card, activity.id)}><TaskKindIcon kind={activity.kind} subtype={activity.subtype} /><span className="plan-acc-actitle">{subtypeLabel(activity.subtype) || activity.title}</span><span className="plan-acc-status">{STATUS_LABEL[activity.status]}</span></button></li>
                  ))}</ul> : <p className="admin-sub">Nenhum card vinculado ainda.</p>}
                </div> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function PlansAndDeliveriesBoard({ plans, deliveries }: { plans: ActionPlan[]; deliveries: FlowDelivery[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("lista");
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [materialWorkspaces, setMaterialWorkspaces] = useState<CreativeMaterialWorkspace[]>([]);
  const [coversLoading, setCoversLoading] = useState(false);
  const [coversError, setCoversError] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  // A URL representa o modal aberto. Depois de atender esse deep link, guardar
  // o id evita que fechar o modal o abra outra vez sem apagar `task` da URL.
  const handledDeepLinkId = useRef<string | null>(null);
  const { sort, setSort } = useSortPref("plano.lista");
  const today = useMemo(() => agencyToday(), []);
  const visiblePlansSource = useMemo(() => plans.filter((plan) => !isRecurrenceTemplate(plan)), [plans]);
  const visibleDeliveriesSource = useMemo(() => deliveries.filter((delivery) => !isRecurrenceTemplate(delivery)), [deliveries]);
  const hydratedPlans = useMemo(() => hydratePlanDeliveries(visiblePlansSource, visibleDeliveriesSource), [visiblePlansSource, visibleDeliveriesSource]);
  const all = useMemo(() => [...hydratedPlans, ...visibleDeliveriesSource], [hydratedPlans, visibleDeliveriesSource]);

  const sorted = (cards: ParentCard[]) => sortItems(cards, sort.key, sort.dir, (card) => ({
    title: card.title, updatedAt: card.updated_at, dueDate: card.end_date ?? card.due_date, completedAt: card.completed_at, position: card.position,
  }));
  const orderedPlans = useMemo(() => sorted(hydratedPlans), [hydratedPlans, sort]);
  const orderedDeliveries = useMemo(() => sorted(visibleDeliveriesSource), [visibleDeliveriesSource, sort]);
  const clientPlans = useMemo(() => orderedPlans.filter((card) => !selectedClient || card.clientName === selectedClient), [orderedPlans, selectedClient]);
  const clientDeliveries = useMemo(() => orderedDeliveries.filter((card) => !selectedClient || card.clientName === selectedClient), [orderedDeliveries, selectedClient]);
  const visiblePlans = useMemo(() => clientPlans.filter((card) => matches(card, query)), [clientPlans, query]);
  const visibleDeliveries = useMemo(() => clientDeliveries.filter((card) => matches(card, query)), [clientDeliveries, query]);
  const feedDeliveries = useMemo(() => visibleDeliveries.filter((card) => card.workflow_version_id && !card.subtype &&
    (card.kind === "criativo" || typeof card.payload?.daily_piece_key === "string")), [visibleDeliveries]);

  useEffect(() => {
    if (view !== "feed") return;
    let active = true;
    const read = async (method: "GET" | "POST") => {
      const response = await fetch("/api/admin/drive/baita/materials", method === "POST"
        ? { method, headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" }
        : { cache: "no-store" });
      if (!response.ok) return false;
      const data = await response.json() as { workspaces?: CreativeMaterialWorkspace[] };
      if (active && data.workspaces) setMaterialWorkspaces(data.workspaces);
      return Boolean(data.workspaces);
    };
    setCoversLoading(true);
    setCoversError(false);
    void (async () => {
      await read("GET").catch(() => false);
      if (!active) return;
      const synced = await read("POST").catch(() => false);
      if (active) { setCoversError(!synced); setCoversLoading(false); }
    })();
    return () => { active = false; };
  }, [view]);

  useEffect(() => {
    const id = searchParams.get("task");
    if (!id) { handledDeepLinkId.current = null; return; }
    if (editing || handledDeepLinkId.current === id) return;
    const target = [...orderedDeliveries, ...orderedPlans].map((card) => deepLinkTarget(card, id)).find(Boolean);
    if (!target) return;
    handledDeepLinkId.current = id;
    setEditing(target);
  }, [editing, orderedDeliveries, orderedPlans, router, searchParams]);

  const toggle = (id: string) => setOpenIds((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const open = (card: ParentCard) => setEditing({ task: asTask(card), clientName: card.clientName, clientSlug: card.clientSlug, relatedTasks: card.activities });
  const openChild = (card: ParentCard, id: string) => {
    const child = card.activities.find((activity) => activity.id === id);
    if (child) setEditing({ task: child, clientName: card.clientName, clientSlug: card.clientSlug, relatedTasks: card.activities, parentTask: asTask(card) });
  };

  return <div className="ap plans-deliveries-board">
    <div className="ap-filters">
      <div className="kb-viewtabs" aria-label="Visualização de Planos e Entregas">
        <button type="button" className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
        <button type="button" className={view === "estrategica" ? "on" : ""} onClick={() => setView("estrategica")}>Estratégica</button>
        <button type="button" className={view === "feed" ? "on" : ""} onClick={() => setView("feed")}>Feed</button>
      </div>
      <PlanSearchBar q={query} onQChange={setQuery} plans={all} selectedClient={selectedClient} onClientChange={setSelectedClient} placeholder={view === "feed" ? "Buscar Criativo ou etapa…" : "Buscar por Plano, Entrega ou etapa…"} />
      <div className="kb-spacer" />
      <NewTaskButton label="+ Tarefa" className="admin-btn primary kb-newtask-btn" />
      <SortMenu sort={sort} onChange={setSort} />
    </div>
    {view === "lista" ? <div className="parent-columns">
      <ParentColumn title="Planos" cards={visiblePlans} empty={query ? "Nenhum Plano para essa busca." : "Nenhum Plano ainda."} openIds={openIds} onToggle={toggle} onOpen={open} onOpenChild={openChild} today={today} />
      <ParentColumn title="Entregas" cards={visibleDeliveries} empty={query ? "Nenhuma Entrega para essa busca." : "Nenhuma Entrega ainda."} openIds={openIds} onToggle={toggle} onOpen={open} onOpenChild={openChild} today={today} />
    </div> : view === "estrategica" ? <StrategicPlanDeliveriesView plans={clientPlans} deliveries={clientDeliveries} query={query} onOpenPlan={open} onOpenPlanActivity={openChild} onOpenDelivery={open} onOpenStep={openChild} />
      : <CreativeFeedView deliveries={feedDeliveries} workspaces={materialWorkspaces} loading={coversLoading} error={coversError} onOpen={open} />}
    {editing ? <CardModalLauncher task={editing.task} clientName={editing.clientName} clientSlug={editing.clientSlug} initialRelatedTasks={editing.relatedTasks} parentTask={editing.parentTask} onClose={() => { setEditing(null); router.refresh(); }} onSaved={() => { setEditing(null); router.refresh(); }} onDeleted={() => { setEditing(null); router.refresh(); }} onChanged={() => router.refresh()} /> : null}
  </div>;
}
