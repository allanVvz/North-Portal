"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import TaskModal from "../TaskModal";
import TaskKindIcon from "../TaskKindIcon";
import SortMenu from "../SortMenu";
import { STATUS_LABEL } from "../kanbanShared";
import PlanSearchBar from "../plano/PlanSearchBar";
import StrategicView, { fmtDate } from "../plano/StrategicView";
import { sortItems } from "../taskSort";
import { useSortPref } from "../taskSortPrefs";
import { FLOW_STEP_COUNT_KEY, subtypeLabel } from "@/lib/taskCatalog";
import type { FlowDelivery } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

// Entregas é a tela do Plano de Ação lida por outro eixo. As duas respondem à
// mesma pergunta — "um pai e o que pende dele" — e por isso reusam literalmente
// os mesmos componentes (PlanSearchBar, StrategicView, SortMenu, o acordeão):
// um plano agrega atividades por composição manual, uma entrega agrega etapas
// por sequência. A única diferença que a tela precisa mostrar é que aqui parte
// das etapas AINDA NÃO EXISTE como card — ela nasce quando a anterior conclui.

type View = "lista" | "estrategica";
type EditingTarget = { task: TaskRecord; clientName: string; clientSlug: string; relatedTasks: TaskRecord[]; parentTask?: TaskRecord };

function deliveryMatches(d: FlowDelivery, needle: string): boolean {
  const n = needle.toLowerCase();
  if (d.title.toLowerCase().includes(n)) return true;
  if (d.clientName.toLowerCase().includes(n)) return true;
  if (d.templateName.toLowerCase().includes(n)) return true;
  if ((d.assignee ?? "").toLowerCase().includes(n)) return true;
  if (fmtDate(d.start_date).toLowerCase().includes(n) || fmtDate(d.end_date).toLowerCase().includes(n)) return true;
  return d.activities.some(
    (a) =>
      (a.assignee ?? "").toLowerCase().includes(n) ||
      a.title.toLowerCase().includes(n) ||
      subtypeLabel(a.subtype).toLowerCase().includes(n) ||
      fmtDate(a.due_date).toLowerCase().includes(n),
  );
}

/** Quantas etapas o molde previa quando a entrega nasceu. Vem do snapshot em
 *  payload, não de uma consulta: o molde pode ter mudado desde então, e a
 *  entrega tem que continuar contando pelo que combinou no início. */
function stepTotal(d: FlowDelivery): number {
  return Number(d.payload?.[FLOW_STEP_COUNT_KEY]) || d.activities.length;
}

export default function FlowDeliveriesBoard({
  initial,
  clients,
  assignees,
}: {
  initial: FlowDelivery[];
  clients: { slug: string; name: string }[];
  assignees: string[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("lista");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [creating, setCreating] = useState(false);
  // Fail-closed enquanto carrega, como em ActionPlansBoard e CardModalLauncher:
  // uma entrega nova nunca pode nascer visível ao cliente por causa de um fetch
  // que ainda não resolveu.
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);
  const { sort, setSort } = useSortPref("entregas.lista");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const deliveries = useMemo(() => {
    const needle = q.trim();
    const matching = needle ? initial.filter((d) => deliveryMatches(d, needle)) : initial;
    return sortItems(matching, sort.key, sort.dir, (d) => ({
      title: d.title,
      updatedAt: d.updated_at,
      dueDate: d.end_date ?? d.due_date,
      completedAt: d.completed_at,
      position: d.position,
    }));
  }, [initial, q, sort]);

  const asTask = (d: FlowDelivery): TaskRecord => {
    const { clientName: _c, clientSlug: _s, templateName: _t, progress: _p, activities: _a, ...task } = d;
    void _c; void _s; void _t; void _p; void _a;
    return task;
  };

  function openDelivery(d: FlowDelivery) {
    setEditing({ task: asTask(d), clientName: d.clientName, clientSlug: d.clientSlug, relatedTasks: d.activities });
  }

  function openStep(d: FlowDelivery, stepId: string) {
    const task = d.activities.find((activity) => activity.id === stepId);
    if (task) setEditing({ task, clientName: d.clientName, clientSlug: d.clientSlug, relatedTasks: d.activities, parentTask: asTask(d) });
  }

  return (
    <div className="ap">
      <div className="ap-filters">
        <div className="kb-viewtabs">
          <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
          <button className={view === "estrategica" ? "on" : ""} onClick={() => setView("estrategica")}>Estratégica</button>
        </div>
        <PlanSearchBar q={q} onQChange={setQ} plans={initial} />
        <div className="kb-spacer" />
        <button type="button" className="admin-btn primary kb-newtask-btn" onClick={() => setCreating(true)}>+ Entrega</button>
        {view === "lista" ? <SortMenu sort={sort} onChange={setSort} /> : null}
      </div>

      {view === "estrategica" ? (
        <StrategicView
          plans={deliveries}
          onOpenPlan={openDelivery}
          onOpenActivity={openStep}
          emptyMessage="Nenhuma entrega em andamento. Crie uma em “+ Entrega” — cada etapa concluída cria a próxima."
        />
      ) : deliveries.length === 0 ? (
        <p className="admin-empty">
          {initial.length === 0
            ? "Nenhuma entrega em andamento. Crie uma em “+ Entrega” — cada etapa concluída cria a próxima."
            : "Nenhuma entrega para essa busca."}
        </p>
      ) : (
        <div className="plan-acc">
          {deliveries.map((d) => {
            const open = openId === d.id;
            const total = stepTotal(d);
            const current = d.activities.length ? d.activities[d.activities.length - 1] : null;
            const pending = Math.max(0, total - d.activities.length);
            return (
              <div className={`plan-acc-item ${open ? "open" : ""}`} key={d.id}>
                <div className="plan-acc-head">
                  <button
                    type="button"
                    className="plan-acc-caret-btn"
                    onClick={() => setOpenId(open ? null : d.id)}
                    aria-label={open ? "Recolher" : "Expandir"}
                  >
                    <span className={`plan-acc-caret ${open ? "on" : ""}`}>▸</span>
                  </button>
                  <button type="button" className="plan-acc-title" onClick={() => openDelivery(d)}>
                    <span className="plan-card-titleline">
                      <TaskKindIcon kind={d.kind} size="lg" /><strong>{d.title}</strong>
                    </span>
                    <em>
                      {d.clientName} · {d.templateName} · etapa {d.activities.length}/{total}
                      {current ? ` · ${subtypeLabel(current.subtype) || current.title}` : ""}
                    </em>
                    <span className="plan-acc-description">
                      {d.description || "Adicione à descrição o que esta entrega precisa ser quando ficar pronta."}
                    </span>
                  </button>
                  <span className="plan-acc-progress">
                    <span className="plan-acc-bar"><span className="plan-acc-fill" style={{ width: `${d.progress}%` }} /></span>
                    <b>{d.progress}%</b>
                  </span>
                </div>

                {open ? (
                  <div className="plan-acc-body">
                    <ul className="plan-acc-list">
                      {d.activities.map((a) => (
                        <li key={a.id}>
                          <button type="button" className="plan-acc-actrow" onClick={() => openStep(d, a.id)}>
                            <TaskKindIcon kind={a.kind} />
                            <span className="plan-acc-actitle">{subtypeLabel(a.subtype) || a.title}</span>
                            <span className="plan-acc-status">{STATUS_LABEL[a.status]}</span>
                            <span className="plan-acc-actpct">{a.progress}%</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/* As etapas que faltam não são linhas do banco — só o
                        contador do molde revela que elas existem. */}
                    {pending > 0 ? (
                      <p className="admin-sub">
                        {pending === 1 ? "Falta 1 etapa" : `Faltam ${pending} etapas`} — cada uma nasce quando a anterior é concluída.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <CardModalLauncher
          task={editing.task}
          clientName={editing.clientName}
          clientSlug={editing.clientSlug}
          initialRelatedTasks={editing.relatedTasks}
          parentTask={editing.parentTask}
          onClose={() => { setEditing(null); router.refresh(); }}
          onSaved={() => { setEditing(null); router.refresh(); }}
          onDeleted={() => { setEditing(null); router.refresh(); }}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {creating ? (
        <TaskModal
          mode="new"
          task={null}
          slug=""
          clients={clients}
          assignees={assignees}
          clientName=""
          creationScope="flow"
          adminReviewers={[]}
          clientReviewers={[]}
          planoVisibilityOn={planoVisibilityOn}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); router.refresh(); }}
          onDeleted={() => {}}
        />
      ) : null}
    </div>
  );
}
