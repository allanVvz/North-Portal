"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CardModalLauncher from "../CardModalLauncher";
import NewTaskButton from "../NewTaskButton";
import SortMenu from "../SortMenu";
import { sortItems } from "../taskSort";
import { useSortPref } from "../taskSortPrefs";
import { agencyToday } from "../recurringState";
import { normalizeSearchText, taskSearchText } from "@/lib/taskSearch";
import { subtypeLabel } from "@/lib/taskCatalog";
import OperationSearchBar from "../operacao/OperationSearchBar";
import { useOperationFilterBar } from "../operacao/useOperationFilterBar";
import { operationMatchesFilters, operationState, parentOperationItem, progressSegments, type OperationFilterAttr } from "../operacao/operationItems";
import { latestFinalCover } from "@/lib/cardMaterials";
import CreativeFeedView from "./CreativeFeedView";
import type { PieceState } from "@/lib/pieces";
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

/** A vez de uma entrega que nasce de rotina: seis "Relatórios · Automação"
 *  iguais só se distinguem pela semana. */
function weekOf(card: ParentCard): string {
  const day = typeof card.payload?.occurrence_date === "string" ? card.payload.occurrence_date : "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(day) || !card.payload?.recurrence_parent_id) return "";
  const [, month, date] = day.slice(0, 10).split("-");
  return `semana de ${date}/${month}`;
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
  covers,
}: {
  title: "Planos" | "Entregas";
  cards: ParentCard[];
  empty: string;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (card: ParentCard) => void;
  onOpenChild: (card: ParentCard, childId: string) => void;
  today: string;
  covers: Map<string, string>;
}) {
  const states = cards.map((card) => operationState(parentOperationItem(card), today));
  const late = states.filter((state) => state.tone === "late").length;
  const attention = states.filter((state) => state.tone === "warn").length;
  // O resumo conta a história antes da lista: quantos, quantos pedem ação.
  const summary = [
    `${cards.length} ${title === "Planos" ? (cards.length === 1 ? "plano" : "planos") : (cards.length === 1 ? "entrega" : "entregas")}`,
    late ? `${late} ${late === 1 ? "atrasado" : "atrasados"}` : "",
    attention ? `${attention} pedem atenção` : "",
  ].filter(Boolean).join(" · ");
  return (
    <section className="parent-column" aria-labelledby={`parent-column-${title.toLowerCase()}`}>
      <header className="parent-column-head">
        <h2 id={`parent-column-${title.toLowerCase()}`}>{title}</h2>
        <span className="parent-column-summary">{summary}</span>
      </header>
      {cards.length === 0 ? <p className="admin-empty parent-column-empty">{empty}</p> : (
        <div className="pd-list">
          {cards.map((card, index) => {
            const open = openIds.has(card.id);
            const item = parentOperationItem(card);
            const state = states[index];
            const segments = progressSegments(item);
            const cover = covers.get(card.id);
            const done = segments.filter((segment) => segment === "done").length;
            return (
              <article className={`pd-card tone-${state.tone}${open ? " open" : ""}`} key={card.id}>
                <div className="pd-card-head">
                  <button type="button" className="pd-card-main" onClick={() => onOpen(card)}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- rota autenticada de miniatura do Drive
                      <img className="pd-cover" src={`/api/admin/drive/thumbnail/${cover}`} alt="" loading="lazy" decoding="async" />
                    ) : null}
                    <span className="pd-card-text">
                      <span className="op-lean-title">{card.title}{weekOf(card) ? <span className="pd-when">{weekOf(card)}</span> : null}</span>
                      <span className="op-lean-state"><span className={`op-dot tone-${state.tone}`} aria-hidden /><b>{state.stage}</b>{state.detail ? <em>· {state.detail}</em> : null}</span>
                      {segments.length ? <span className="op-lean-steps" aria-label={`${done} de ${segments.length} concluídas`}>{segments.map((segment, at) => <i key={at} className={segment} />)}</span> : null}
                      <span className="op-lean-meta">
                        <span>{card.clientName}</span>
                        <span className={card.assignee ? "" : "is-empty"}>{card.assignee || "Sem responsável"}</span>
                        {segments.length ? <span>{done}/{segments.length} {title === "Planos" ? "feitos" : "etapas"}</span> : null}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="pd-card-toggle" onClick={() => onToggle(card.id)} aria-expanded={open} aria-label={open ? "Recolher itens" : "Ver itens"}>
                    <span aria-hidden>{open ? "–" : "+"}</span>
                  </button>
                </div>
                {open ? (
                  card.activities.length ? (
                    <ul className="pd-children">
                      {card.activities.map((activity) => {
                        const child = operationState({ id: activity.id, task: activity, clientName: card.clientName, clientSlug: card.clientSlug, routine: false, level: "tarefa", members: [] }, today);
                        return (
                          <li key={activity.id}>
                            <button type="button" onClick={() => onOpenChild(card, activity.id)}>
                              <span className={`op-dot tone-${child.tone}`} aria-hidden />
                              <span className="pd-child-title">{subtypeLabel(activity.subtype) || activity.title}</span>
                              <span className="pd-child-state">{child.stage}{child.detail ? ` · ${child.detail}` : ""}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="admin-sub pd-children-empty">Nenhum item vinculado ainda.</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Frequência é atributo de rotina; aqui só há planos e entregas.
const PARENT_ATTRS: OperationFilterAttr[] = ["status", "situacao", "tipo", "subtipo", "cliente", "prioridade", "responsavel"];

export default function PlansAndDeliveriesBoard({ plans, deliveries }: { plans: ActionPlan[]; deliveries: FlowDelivery[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("lista");
  const [query, setQuery] = useState("");
  const [materialWorkspaces, setMaterialWorkspaces] = useState<CreativeMaterialWorkspace[]>([]);
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
  // A mesma caixa de busca + filtros da aba Tarefas e Rotinas, com o mesmo
  // padrão: concluídos ficam fora até alguém pedir para vê-los.
  const allItems = useMemo(() => all.map(parentOperationItem), [all]);
  const { filters, barProps } = useOperationFilterBar(allItems, today, PARENT_ATTRS);
  const passes = (card: ParentCard) => operationMatchesFilters(parentOperationItem(card), filters, today);
  const clientPlans = useMemo(() => orderedPlans.filter(passes), [orderedPlans, filters, today]);
  const clientDeliveries = useMemo(() => orderedDeliveries.filter(passes), [orderedDeliveries, filters, today]);
  const visiblePlans = useMemo(() => clientPlans.filter((card) => matches(card, query)), [clientPlans, query]);
  const visibleDeliveries = useMemo(() => clientDeliveries.filter((card) => matches(card, query)), [clientDeliveries, query]);
  // Link da Home: ?visao=feed&estado=atrasada abre o Feed já filtrado.
  const feedState = searchParams.get("estado") as PieceState | null;
  useEffect(() => { if (searchParams.get("visao") === "feed") setView("feed"); }, [searchParams]);
  const feedClient = filters.find((filter) => filter.attr === "cliente")?.value ?? null;
  // Peça legada fora de planos e entregas: busca o card pelo id para abrir.
  // Dois cliques rápidos em peças diferentes: só o último abre (latestOpen).
  const latestOpen = useRef<string | null>(null);
  const openById = async (id: string) => {
    latestOpen.current = id;
    const target = [...orderedDeliveries, ...orderedPlans].map((card) => deepLinkTarget(card, id)).find(Boolean);
    if (target) { setEditing(target); return; }
    try {
      const response = await fetch(`/api/admin/tasks/${id}`);
      if (!response.ok || latestOpen.current !== id) return;
      const task = await response.json() as TaskRecord & { clientName?: string; clientSlug?: string };
      if (latestOpen.current !== id) return;
      setEditing({ task, clientName: task.clientName ?? "", clientSlug: task.clientSlug ?? "", relatedTasks: [] });
    } catch {
      // rede caiu: o clique não abre nada, sem erro solto no console
    }
  };

  // Os arquivos do Drive servem às capas das duas visões. A leitura (GET) é
  // barata e roda uma vez; a sincronização com o Drive (POST) é pesada e só
  // roda quando alguém abre o Feed.
  useEffect(() => {
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
    void (async () => {
      await read("GET").catch(() => false);
      // Entrar no Feed sincroniza os arquivos com o Drive (pesado, só aqui).
      if (active && view === "feed") await read("POST").catch(() => false);
    })();
    return () => { active = false; };
  }, [view]);
  const covers = useMemo(() => {
    const byCreative = new Map<string, CreativeMaterialWorkspace[]>();
    for (const workspace of materialWorkspaces) byCreative.set(workspace.creative_task_id, [...(byCreative.get(workspace.creative_task_id) ?? []), workspace]);
    const map = new Map<string, string>();
    for (const [id, list] of byCreative) { const cover = latestFinalCover(list); if (cover) map.set(id, cover.drive_file_id); }
    return map;
  }, [materialWorkspaces]);

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
      <OperationSearchBar q={query} onQChange={setQuery} placeholder={view === "feed" ? "Buscar Criativo ou etapa…" : "Buscar por Plano, Entrega ou etapa…"} {...barProps} />
      <div className="kb-spacer" />
      <NewTaskButton label="+ Tarefa" className="admin-btn primary kb-newtask-btn" />
      <SortMenu sort={sort} onChange={setSort} />
    </div>
    {view === "lista" ? <div className="parent-columns">
      <ParentColumn title="Planos" cards={visiblePlans} empty={query ? "Nenhum Plano para essa busca." : "Nenhum Plano ainda."} openIds={openIds} onToggle={toggle} onOpen={open} onOpenChild={openChild} today={today} covers={covers} />
      <ParentColumn title="Entregas" cards={visibleDeliveries} empty={query ? "Nenhuma Entrega para essa busca." : "Nenhuma Entrega ainda."} openIds={openIds} onToggle={toggle} onOpen={open} onOpenChild={openChild} today={today} covers={covers} />
    </div> : view === "estrategica" ? <StrategicPlanDeliveriesView plans={clientPlans} deliveries={clientDeliveries} query={query} onOpenPlan={open} onOpenPlanActivity={openChild} onOpenDelivery={open} onOpenStep={openChild} />
      : <CreativeFeedView clientName={feedClient} initialState={feedState} onOpen={(id) => void openById(id)} />}
    {editing ? <CardModalLauncher task={editing.task} clientName={editing.clientName} clientSlug={editing.clientSlug} initialRelatedTasks={editing.relatedTasks} parentTask={editing.parentTask} onClose={() => { setEditing(null); router.refresh(); }} onSaved={() => { setEditing(null); router.refresh(); }} onDeleted={() => { setEditing(null); router.refresh(); }} onChanged={() => router.refresh()} /> : null}
  </div>;
}
