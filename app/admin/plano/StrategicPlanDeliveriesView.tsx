"use client";

import { useMemo, useState } from "react";
import { STATUS_LABEL } from "../kanbanShared";
import { DEADLINE_LABEL, deadlineStateOf } from "../deadlineState";
import { agencyToday } from "../recurringState";
import TaskKindIcon from "../TaskKindIcon";
import { fmtDate } from "./StrategicView";
import { taskMatchesQuery } from "@/lib/taskSearch";
import type { ActionPlan, FlowDelivery, ParentCard } from "@/lib/supabase";
import { buildStrategicTree, filterStrategicTree, type StrategicNode } from "./strategicTree";
import { EMPTY_STRATEGIC_FILTER, isFilterActive, matchesWhen, matchesWho, matchesWhy, type StrategicFilter } from "./strategicFilters";

function cardMatches(card: ParentCard, query: string) {
  if (taskMatchesQuery(card, query, { clientName: card.clientName, typeLabel: card.typeLabel })) return true;
  return card.activities.some((activity) => taskMatchesQuery(activity, query, { clientName: card.clientName }));
}

/** Mesmos selos da Lista: tipo (Plano/Entrega) + situação do prazo. A cor do
 * cartão (is-atrasada/-parada/-concluida) segue a mesma situação. */
function stateOf(card: ParentCard) {
  return card.completed_at ? "concluida" : deadlineStateOf(card, agencyToday());
}

function BranchTags({ label, state }: { label: "Plano" | "Entrega"; state: ReturnType<typeof stateOf> }) {
  return <span className="plan-acc-tags"><span className="parent-kind-badge">{label}</span><span className={`kb-situacao s-${state}`}>{DEADLINE_LABEL[state]}</span></span>;
}

function DeliveryBranch({
  node,
  nested,
  query,
  onOpenDelivery,
  onOpenStep,
}: {
  node: StrategicNode;
  nested: boolean;
  query: string;
  onOpenDelivery: (delivery: FlowDelivery) => void;
  onOpenStep: (delivery: FlowDelivery, stepId: string) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const delivery = node.card as FlowDelivery;
  // Uma busca por etapa só é útil se a etapa aparecer sem um clique extra.
  const open = manualOpen || (query.trim().length > 0 && cardMatches(delivery, query));
  const state = stateOf(delivery);
  return (
    <article className={`plan-strat-card plan-delivery-branch is-${state} ${nested ? "nested" : ""} ${open ? "open" : ""}`}>
      <div className="plan-strat-headrow">
        <button type="button" className="plan-strat-headtoggle" aria-expanded={open} onClick={() => setManualOpen((value) => !value)}>
          <span className={`plan-acc-caret ${open ? "on" : ""}`} aria-hidden>▸</span>
          <span className="plan-strat-headtext">
            <BranchTags label="Entrega" state={state} />
            <span className="plan-card-titleline"><TaskKindIcon kind={delivery.kind} subtype={delivery.subtype} format={delivery.payload?.formato} /><strong>{delivery.title}</strong></span>
            <span className="plan-strat-count">{delivery.activities.length} etapa{delivery.activities.length === 1 ? "" : "s"}</span>
          </span>
        </button>
        <button type="button" className="admin-btn ghost plan-strat-open" onClick={() => onOpenDelivery(delivery)}>Abrir</button>
      </div>
      {open ? (
        <div className="plan-delivery-steps">
          {delivery.activities.length ? delivery.activities.map((step) => (
            <button key={step.id} type="button" className="plan-delivery-step" onClick={() => onOpenStep(delivery, step.id)}>
              <TaskKindIcon kind={step.kind} subtype={step.subtype} />
              <span>{step.title}</span><small>{fmtDate(step.due_date)} · {STATUS_LABEL[step.status]}</small>
            </button>
          )) : <p className="admin-sub">Nenhuma etapa materializada ainda.</p>}
        </div>
      ) : null}
    </article>
  );
}

function PlanBranch({
  node,
  query,
  onOpenPlan,
  onOpenPlanActivity,
  onOpenDelivery,
  onOpenStep,
}: {
  node: StrategicNode;
  query: string;
  onOpenPlan: (plan: ActionPlan) => void;
  onOpenPlanActivity: (plan: ActionPlan, activityId: string) => void;
  onOpenDelivery: (delivery: FlowDelivery) => void;
  onOpenStep: (delivery: FlowDelivery, stepId: string) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const plan = node.card as ActionPlan;
  const nestedIds = new Set(node.deliveries.map((delivery) => delivery.card.id));
  const simpleActivities = plan.activities.filter((activity) => !nestedIds.has(activity.id));
  const open = manualOpen || (query.trim().length > 0 && (cardMatches(plan, query) || node.deliveries.some((delivery) => cardMatches(delivery.card, query))));
  const state = stateOf(plan);
  return (
    <article className={`plan-strat-card plan-root-branch is-${state} ${open ? "open" : ""}`}>
      <div className="plan-strat-headrow">
        <button type="button" className="plan-strat-headtoggle" aria-expanded={open} onClick={() => setManualOpen((value) => !value)}>
          <span className={`plan-acc-caret ${open ? "on" : ""}`} aria-hidden>▸</span>
          <span className="plan-strat-headtext">
            <BranchTags label="Plano" state={state} />
            <span className="plan-card-titleline"><TaskKindIcon kind={plan.kind} /><strong>{plan.title}</strong></span>
            {/* Sem descrição, nada: "Sem descrição." repetido em cada cartão
                lia como conteúdo, não como campo vazio. */}
            {plan.description ? <span className="plan-strat-description">{plan.description}</span> : null}
          </span>
        </button>
        <span className="plan-strat-progress"><span className="plan-strat-bar"><span className="plan-strat-fill" style={{ width: `${plan.progress}%` }} /></span><b>{plan.progress}%</b></span>
        <button type="button" className="admin-btn ghost plan-strat-open" onClick={() => onOpenPlan(plan)}>Abrir</button>
      </div>
      {open ? (
        <div className="plan-strat-children">
          {node.deliveries.length ? node.deliveries.map((delivery) => (
            <DeliveryBranch key={`${plan.id}:${delivery.card.id}`} node={delivery} nested query={query} onOpenDelivery={onOpenDelivery} onOpenStep={onOpenStep} />
          )) : null}
          {simpleActivities.length ? <div className="plan-simple-activities">
            {simpleActivities.map((activity) => <button type="button" key={activity.id} onClick={() => onOpenPlanActivity(plan, activity.id)}><TaskKindIcon kind={activity.kind} subtype={activity.subtype} /><span>{activity.title}</span><small>{STATUS_LABEL[activity.status]}</small></button>)}
          </div> : null}
          {!node.deliveries.length && !simpleActivities.length ? <p className="admin-sub">Nenhum card vinculado a este plano.</p> : null}
        </div>
      ) : null}
    </article>
  );
}

/** A leitura Estratégica dos dois agregadores; ela nunca cria uma raiz extra para uma entrega ligada. */
export default function StrategicPlanDeliveriesView({
  plans,
  deliveries,
  query,
  onOpenPlan,
  onOpenPlanActivity,
  onOpenDelivery,
  onOpenStep,
}: {
  plans: ActionPlan[];
  deliveries: FlowDelivery[];
  query: string;
  onOpenPlan: (plan: ActionPlan) => void;
  onOpenPlanActivity: (plan: ActionPlan, activityId: string) => void;
  onOpenDelivery: (delivery: FlowDelivery) => void;
  onOpenStep: (delivery: FlowDelivery, stepId: string) => void;
}) {
  const [filter, setFilter] = useState<StrategicFilter>(EMPTY_STRATEGIC_FILTER);
  const updateFilter = (part: Partial<StrategicFilter>) => setFilter((current) => ({ ...current, ...part }));
  const hasQuery = query.trim().length > 0;
  const hasFilters = isFilterActive(filter);
  const matchesFilter = (card: ParentCard) => matchesWho(card, filter.who) && matchesWhen(card, filter.from, filter.to) && matchesWhy(card, filter.why);
  const groups = useMemo(() => {
    const tree = buildStrategicTree(plans, deliveries);
    return hasQuery || hasFilters ? filterStrategicTree(tree, (card) => (!hasQuery || cardMatches(card, query)) && matchesFilter(card)) : tree;
  }, [plans, deliveries, query, hasQuery, hasFilters, filter]);

  return (
    <div className="plan-strat plan-strat-combined">
      <section className="plan-combined-filterbar" aria-label="Filtrar Planos e Entregas">
        <label>Quem<input value={filter.who} onChange={(event) => updateFilter({ who: event.target.value })} placeholder="Responsável" /></label>
        <label>Quando<span><input type="date" aria-label="Início" value={filter.from} onChange={(event) => updateFilter({ from: event.target.value })} /><input type="date" aria-label="Fim" value={filter.to} onChange={(event) => updateFilter({ to: event.target.value })} /></span></label>
        <label>Por quê<input value={filter.why} onChange={(event) => updateFilter({ why: event.target.value })} placeholder="Justificativa" /></label>
        {hasFilters ? <button type="button" className="admin-btn ghost" onClick={() => setFilter(EMPTY_STRATEGIC_FILTER)}>Limpar filtros</button> : null}
      </section>
      {!groups.length ? <p className="admin-empty">{hasQuery || hasFilters ? "Nenhum Plano ou Entrega com esses filtros." : "Ainda não há Planos nem Entregas."}</p> : groups.map((group) => (
        <section className="plan-strat-group" key={group.key}>
          <h2 className="plan-strat-groupname">{group.clientName}</h2>
          <div className="plan-strat-groupitems">
            {group.roots.map((node) => node.kind === "plan" ? (
              <PlanBranch key={node.card.id} node={node} query={query} onOpenPlan={onOpenPlan} onOpenPlanActivity={onOpenPlanActivity} onOpenDelivery={onOpenDelivery} onOpenStep={onOpenStep} />
            ) : (
              <DeliveryBranch key={node.card.id} node={node} nested={false} query={query} onOpenDelivery={onOpenDelivery} onOpenStep={onOpenStep} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
