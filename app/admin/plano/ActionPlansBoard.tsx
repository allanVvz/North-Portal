"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import TaskModal from "../TaskModal";
import { STATUS_LABEL } from "../kanbanShared";
import PlanSearchBar from "./PlanSearchBar";
import StrategicView, { fmtDate } from "./StrategicView";
import TaskKindIcon from "../TaskKindIcon";
import type { ActionPlan } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

type View = "lista" | "estrategica";
type EditingTarget = { task: TaskRecord; clientName: string; clientSlug: string; relatedTasks: TaskRecord[]; parentTask?: TaskRecord };

// Matches the free-text query against every attribute the user might filter
// by here — cliente, responsável (per-activity assignee) and prazo (plano ou
// atividade) — "Todos os clientes" is simply an empty query.
function planMatches(p: ActionPlan, needle: string): boolean {
  const n = needle.toLowerCase();
  if (p.title.toLowerCase().includes(n)) return true;
  if (p.clientName.toLowerCase().includes(n)) return true;
  if ((p.assignee ?? "").toLowerCase().includes(n)) return true;
  if (fmtDate(p.start_date).toLowerCase().includes(n) || fmtDate(p.end_date).toLowerCase().includes(n)) return true;
  return p.activities.some(
    (a) =>
      (a.assignee ?? "").toLowerCase().includes(n) ||
      a.title.toLowerCase().includes(n) ||
      fmtDate(a.due_date).toLowerCase().includes(n),
  );
}

// Plano de Ação é ordenado por prioridade, não por ordem de criação: o que a
// tela responde é "no que a agência precisa se concentrar". Desempate pelo
// prazo (fim do plano, ou o prazo solto quando não há fim), com quem não tem
// data no fim — mesma regra do resto do admin —, e por fim a última edição.
const PRIORITY_RANK: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

function sortPlansByPriority(plans: ActionPlan[]): ActionPlan[] {
  return [...plans].sort((a, b) => {
    const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3);
    if (rank !== 0) return rank;
    const aDate = a.end_date ?? a.due_date;
    const bDate = b.end_date ?? b.due_date;
    if (Boolean(aDate) !== Boolean(bDate)) return aDate ? -1 : 1;
    if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

export default function ActionPlansBoard({
  initial,
  clients,
  assignees,
}: {
  initial: ActionPlan[];
  clients: { slug: string; name: string }[];
  assignees: string[];
}) {
  const router = useRouter();
  // Lista é a visão principal — a Estratégica é a leitura de planejamento, não
  // a tela de trabalho do dia.
  const [view, setView] = useState<View>("lista");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [creating, setCreating] = useState(false);
  // Real global master switch — defaults to the "hidden until loaded" side
  // (false) so a brand-new plan never silently persists client_visible:true
  // before the fetch resolves. Same fix as CardModalLauncher.tsx.
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const plans = useMemo(() => {
    const needle = q.trim();
    const matching = needle ? initial.filter((p) => planMatches(p, needle)) : initial;
    return sortPlansByPriority(matching);
  }, [initial, q]);

  // The plan card as a TaskRecord for the editor modal.
  const asTask = (p: ActionPlan): TaskRecord => {
    // Strip the accordion-only fields; the rest is a genuine TaskRecord.
    const { clientName: _c, clientSlug: _s, progress: _p, activities: _a, ...task } = p;
    void _c; void _s; void _p; void _a;
    return task;
  };

  function openPlan(p: ActionPlan) {
    setEditing({ task: asTask(p), clientName: p.clientName, clientSlug: p.clientSlug, relatedTasks: p.activities });
  }

  function openActivity(p: ActionPlan, activityId: string) {
    const task = p.activities.find((activity) => activity.id === activityId);
    if (task) setEditing({ task, clientName: p.clientName, clientSlug: p.clientSlug, relatedTasks: [], parentTask: asTask(p) });
  }

  return (
    <div className="ap">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Operação</p>
          <h1 className="admin-title">Plano de Ação</h1>
        </div>
        <button type="button" className="admin-btn primary" onClick={() => setCreating(true)}>+ Novo plano</button>
      </header>
      <div className="ap-filters">
        <div className="kb-viewtabs">
          <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
          <button className={view === "estrategica" ? "on" : ""} onClick={() => setView("estrategica")}>Estratégica</button>
        </div>
        <PlanSearchBar q={q} onQChange={setQ} plans={initial} />
      </div>

      {view === "estrategica" ? (
        <StrategicView plans={plans} onOpenPlan={openPlan} onOpenActivity={openActivity} />
      ) : plans.length === 0 ? (
        <p className="admin-empty">Nenhum plano de ação ainda. Crie um card do tipo “Plano de Ação” no Kanban.</p>
      ) : (
        <div className="plan-acc">
          {plans.map((p) => {
            const open = openId === p.id;
            return (
              <div className={`plan-acc-item ${open ? "open" : ""}`} key={p.id}>
                <div className="plan-acc-head">
                  <button
                    type="button"
                    className="plan-acc-caret-btn"
                    onClick={() => setOpenId(open ? null : p.id)}
                    aria-label={open ? "Recolher" : "Expandir"}
                  >
                    <span className={`plan-acc-caret ${open ? "on" : ""}`}>▸</span>
                  </button>
                  <button type="button" className="plan-acc-title" onClick={() => openPlan(p)}>
                    <span className="plan-card-titleline"><TaskKindIcon kind={p.kind} size="lg" /><strong>{p.title}</strong></span>
                    <em>{p.clientName} · {p.activities.length} atividade{p.activities.length === 1 ? "" : "s"}</em>
                    <span className="plan-acc-description">{p.description || "Adicione à descrição o porquê e o resultado esperado deste plano."}</span>
                  </button>
                  <span className="plan-acc-progress">
                    <span className="plan-acc-bar"><span className="plan-acc-fill" style={{ width: `${p.progress}%` }} /></span>
                    <b>{p.progress}%</b>
                  </span>
                </div>

                {open ? (
                  <div className="plan-acc-body">
                    {p.activities.length === 0 ? (
                      <p className="admin-sub">Nenhuma atividade vinculada. Vincule tarefas a este plano no card (atributo “Plano de Ação”).</p>
                    ) : (
                      <ul className="plan-acc-list">
                        {p.activities.map((a) => (
                          <li key={a.id}>
                            <button type="button" className="plan-acc-actrow" onClick={() => openActivity(p, a.id)}>
                              <TaskKindIcon kind={a.kind} />
                              <span className="plan-acc-actitle">{a.title}</span>
                              <span className="plan-acc-status">{STATUS_LABEL[a.status]}</span>
                              <span className="plan-acc-actpct">{a.progress}%</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
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
          initialKind="plano_acao"
          creationScope="plan"
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
