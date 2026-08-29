"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import TaskModal, { type TaskCreationScope } from "../TaskModal";
import TaskKindIcon from "../TaskKindIcon";
import SortMenu from "../SortMenu";
import { STATUS_LABEL } from "../kanbanShared";
import PlanSearchBar from "../plano/PlanSearchBar";
import StrategicView, { fmtDate } from "../plano/StrategicView";
import { sortItems } from "../taskSort";
import { useSortPref, type SortScope } from "../taskSortPrefs";
import { FLOW_STEP_COUNT_KEY, subtypeLabel } from "@/lib/taskCatalog";
import type { ParentCard } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

// O acordeão de PAIS — um componente, duas abas.
//
// Entrega e Plano de Ação respondem à mesma pergunta ("um pai e o que pende
// dele") e passaram a usar a mesma arquitetura: mesmo tipo de card, mesmos
// elos, mesmo rollup. O que muda entre eles é o `behavior` do tipo e os textos.
// Manter dois componentes espelhados era a duplicação que esta rodada existe
// para matar; a separação entre as duas telas é de navegação, não de código.
//
// A única assimetria real: numa entrega parte das etapas AINDA NÃO EXISTE como
// card — nasce quando a anterior conclui —, e o contador precisa dizer isso.
// Num plano, tudo que existe já foi montado por alguém.

type View = "lista" | "estrategica";
type EditingTarget = { task: TaskRecord; clientName: string; clientSlug: string; relatedTasks: TaskRecord[]; parentTask?: TaskRecord };

export type ParentBoardTexts = {
  newLabel: string;
  empty: string;
  emptyQuery: string;
  searchPlaceholder: string;
  descriptionHint: string;
};

function parentMatches(d: ParentCard, needle: string): boolean {
  const n = needle.toLowerCase();
  if (d.title.toLowerCase().includes(n)) return true;
  if (d.clientName.toLowerCase().includes(n)) return true;
  if (d.typeLabel.toLowerCase().includes(n)) return true;
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

/** Quantas etapas o tipo previa quando a entrega nasceu. Vem do snapshot em
 *  payload, não de uma consulta: o tipo pode ter mudado desde então, e a
 *  entrega tem que continuar contando pelo que combinou no início. */
function stepTotal(d: ParentCard): number {
  return Number(d.payload?.[FLOW_STEP_COUNT_KEY]) || d.activities.length;
}

export default function ParentCardsBoard({
  initial,
  clients,
  assignees,
  texts,
  scope,
  initialKind,
  sortScope,
  showStepCount,
}: {
  initial: ParentCard[];
  clients: { slug: string; name: string }[];
  assignees: string[];
  texts: ParentBoardTexts;
  scope: TaskCreationScope;
  initialKind?: string;
  sortScope: SortScope;
  /** Entregas contam "3/4 etapas" porque as próximas ainda vão nascer; um
   *  plano conta só quantas atividades tem. */
  showStepCount: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("lista");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [creating, setCreating] = useState(false);
  // Fail-closed enquanto carrega, como em CardModalLauncher: um pai novo nunca
  // pode nascer visível ao cliente por causa de um fetch que ainda não resolveu.
  const [planoVisibilityOn, setPlanoVisibilityOn] = useState(false);
  const { sort, setSort } = useSortPref(sortScope);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setPlanoVisibilityOn(Boolean(data.enabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const parents = useMemo(() => {
    const needle = q.trim();
    const matching = needle ? initial.filter((d) => parentMatches(d, needle)) : initial;
    return sortItems(matching, sort.key, sort.dir, (d) => ({
      title: d.title,
      updatedAt: d.updated_at,
      dueDate: d.end_date ?? d.due_date,
      completedAt: d.completed_at,
      position: d.position,
    }));
  }, [initial, q, sort]);

  const asTask = (d: ParentCard): TaskRecord => {
    const { clientName: _c, clientSlug: _s, typeLabel: _t, progress: _p, activities: _a, ...task } = d;
    void _c; void _s; void _t; void _p; void _a;
    return task;
  };

  function openParent(d: ParentCard) {
    setEditing({ task: asTask(d), clientName: d.clientName, clientSlug: d.clientSlug, relatedTasks: d.activities });
  }

  function openChild(d: ParentCard, childId: string) {
    const task = d.activities.find((activity) => activity.id === childId);
    if (task) setEditing({ task, clientName: d.clientName, clientSlug: d.clientSlug, relatedTasks: d.activities, parentTask: asTask(d) });
  }

  return (
    <div className="ap">
      <div className="ap-filters">
        <div className="kb-viewtabs">
          <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
          <button className={view === "estrategica" ? "on" : ""} onClick={() => setView("estrategica")}>Estratégica</button>
        </div>
        <PlanSearchBar q={q} onQChange={setQ} plans={initial} placeholder={texts.searchPlaceholder} />
        <div className="kb-spacer" />
        <button type="button" className="admin-btn primary kb-newtask-btn" onClick={() => setCreating(true)}>{texts.newLabel}</button>
        {view === "lista" ? <SortMenu sort={sort} onChange={setSort} /> : null}
      </div>

      {view === "estrategica" ? (
        <StrategicView plans={parents} onOpenPlan={openParent} onOpenActivity={openChild} emptyMessage={texts.empty} />
      ) : parents.length === 0 ? (
        <p className="admin-empty">{initial.length === 0 ? texts.empty : texts.emptyQuery}</p>
      ) : (
        <div className="plan-acc">
          {parents.map((d) => {
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
                  <button type="button" className="plan-acc-title" onClick={() => openParent(d)}>
                    <span className="plan-card-titleline">
                      <TaskKindIcon kind={d.kind} size="lg" /><strong>{d.title}</strong>
                    </span>
                    <em>
                      {d.clientName} · {d.typeLabel} ·{" "}
                      {showStepCount
                        ? `etapa ${d.activities.length}/${total}`
                        : `${d.activities.length} atividade${d.activities.length === 1 ? "" : "s"}`}
                      {showStepCount && current ? ` · ${subtypeLabel(current.subtype) || current.title}` : ""}
                    </em>
                    <span className="plan-acc-description">{d.description || texts.descriptionHint}</span>
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
                          <button type="button" className="plan-acc-actrow" onClick={() => openChild(d, a.id)}>
                            <TaskKindIcon kind={a.kind} />
                            <span className="plan-acc-actitle">{subtypeLabel(a.subtype) || a.title}</span>
                            <span className="plan-acc-status">{STATUS_LABEL[a.status]}</span>
                            <span className="plan-acc-actpct">{a.progress}%</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/* As etapas que faltam não são linhas do banco — só o
                        contador do tipo revela que elas existem. */}
                    {showStepCount && pending > 0 ? (
                      <p className="admin-sub">
                        {pending === 1 ? "Falta 1 etapa" : `Faltam ${pending} etapas`} — cada uma nasce quando a anterior é concluída.
                      </p>
                    ) : null}
                    {!showStepCount && d.activities.length === 0 ? (
                      <p className="admin-sub">Nenhuma atividade vinculada. Vincule tarefas a este plano no card (atributo “Plano de Ação”).</p>
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
          creationScope={scope}
          initialKind={initialKind}
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
