"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import TaskKindIcon from "../TaskKindIcon";
import { STATUS_LABEL } from "../kanbanShared";
import { FLOW_STEP_COUNT_KEY, subtypeLabel } from "@/lib/taskCatalog";
import type { FlowDelivery } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

// A lista das entregas em cascata. Existe porque a entrega é a única coisa da
// operação que NÃO aparece no quadro Tarefas: seu status é derivado das etapas,
// então não há coluna honesta para ela (mesma razão de plano_acao e do pai
// recorrente). O quadro mostra a etapa de agora; aqui se vê a corrente inteira,
// inclusive as etapas que ainda não nasceram.

function currentStep(delivery: FlowDelivery) {
  // A etapa corrente é a última materializada — a cascata é sequencial, então
  // a mais avançada em `position` é sempre onde o trabalho está. Uma etapa
  // reaberta não muda isso: a seguinte continua existindo (append-only).
  return delivery.steps.length ? delivery.steps[delivery.steps.length - 1] : null;
}

function matches(delivery: FlowDelivery, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return [delivery.title, delivery.clientName, delivery.templateName, delivery.assignee ?? ""]
    .concat(delivery.steps.map((step) => step.title))
    .some((value) => value.toLowerCase().includes(n));
}

export default function FlowDeliveriesBoard({ initial }: { initial: FlowDelivery[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // O card aberto vem com a entrega a que pertence, para o modal já mostrar a
  // relação sem esperar o fetch por id.
  const [open, setOpen] = useState<{ task: TaskRecord; delivery: FlowDelivery } | null>(null);

  const deliveries = useMemo(() => initial.filter((d) => matches(d, query)), [initial, query]);

  if (!initial.length) {
    return <p className="admin-empty">Nenhuma entrega em andamento. Use “+ Nova entrega” para começar uma.</p>;
  }

  return (
    <>
      <div className="rec-toolbar">
        <input
          className="admin-input"
          placeholder="Buscar por entrega, cliente, fluxo ou etapa…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar entregas"
        />
      </div>

      <div className="flow-list">
        {deliveries.map((delivery) => {
          const step = currentStep(delivery);
          const total = Number(delivery.payload?.[FLOW_STEP_COUNT_KEY]) || delivery.steps.length;
          const expanded = openId === delivery.id;
          return (
            <article className="flow-row" key={delivery.id}>
              <button
                type="button"
                className="flow-row-head"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : delivery.id)}
              >
                <TaskKindIcon kind={delivery.kind} />
                <span className="flow-row-title">{delivery.title}</span>
                <span className="flow-row-client">{delivery.clientName}</span>
                <span className="flow-row-step">
                  {step ? `${delivery.steps.length}/${total} · ${subtypeLabel(step.subtype) || step.title}` : `0/${total}`}
                </span>
                <span className="flow-row-progress">
                  <span className="kb-card-progress-track"><span className="kb-card-progress-fill" style={{ width: `${delivery.progress}%` }} /></span>
                  <b>{delivery.progress}%</b>
                </span>
                <span className="flow-row-caret" aria-hidden>{expanded ? "⌃" : "⌄"}</span>
              </button>

              {expanded ? (
                <div className="flow-row-steps">
                  {delivery.steps.map((s) => (
                    <button type="button" className="flow-step" key={s.id} onClick={() => setOpen({ task: s, delivery })}>
                      <TaskKindIcon kind={s.kind} size="sm" />
                      <span className="flow-step-title">{s.title}</span>
                      <span className="flow-step-status">{STATUS_LABEL[s.status]}</span>
                      <span className="flow-step-pct">{s.progress}%</span>
                    </button>
                  ))}
                  {/* As etapas que faltam não são linhas do banco; o contador do
                      molde é o que revela que elas existem. */}
                  {delivery.steps.length < total ? (
                    <p className="admin-sub flow-step-pending">
                      Faltam {total - delivery.steps.length} etapa(s) — cada uma nasce quando a anterior é concluída.
                    </p>
                  ) : null}
                  <button type="button" className="admin-btn ghost flow-open-delivery" onClick={() => setOpen({ task: delivery, delivery })}>
                    Abrir entrega
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
        {deliveries.length === 0 ? <p className="admin-empty">Nenhuma entrega para essa busca.</p> : null}
      </div>

      {open ? (
        <CardModalLauncher
          task={open.task}
          clientName={open.delivery.clientName}
          clientSlug={open.delivery.clientSlug}
          initialRelatedTasks={open.delivery.steps}
          parentTask={open.task.id === open.delivery.id ? undefined : open.delivery}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); router.refresh(); }}
          onDeleted={() => { setOpen(null); router.refresh(); }}
        />
      ) : null}
    </>
  );
}
