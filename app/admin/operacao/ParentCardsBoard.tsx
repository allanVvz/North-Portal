"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import NewTaskButton from "../NewTaskButton";
import TaskKindIcon from "../TaskKindIcon";
import SortMenu from "../SortMenu";
import { STATUS_LABEL } from "../kanbanShared";
import PlanSearchBar from "../plano/PlanSearchBar";
import StrategicView from "../plano/StrategicView";
import { sortItems } from "../taskSort";
import { useSortPref, type SortScope } from "../taskSortPrefs";
import { normalizeSearchText, taskSearchText } from "@/lib/taskSearch";
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

// A busca do card-pai é a busca de tarefa canônica (lib/taskSearch.ts) aplicada
// ao pai OU a qualquer atividade filha: um termo casa se aparece no haystack do
// pai ou no de uma etapa. Termos múltiplos são E, mas cada um pode casar num
// lado diferente ("cliente x" no pai + "roteiro" numa atividade).
function parentMatches(d: ParentCard, query: string): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    taskSearchText(d, { clientName: d.clientName, typeLabel: d.typeLabel }),
    ...d.activities.map((a) => taskSearchText(a, { clientName: d.clientName })),
  ].join(" ");
  return terms.every((term) => haystack.includes(term));
}

/** Quantas etapas o tipo previa quando a entrega nasceu. Vem do snapshot em
 *  payload, não de uma consulta: o tipo pode ter mudado desde então, e a
 *  entrega tem que continuar contando pelo que combinou no início. */
function stepTotal(d: ParentCard): number {
  return Number(d.payload?.[FLOW_STEP_COUNT_KEY]) || d.activities.length;
}

export default function ParentCardsBoard({
  initial,
  texts,
  sortScope,
  showStepCount,
}: {
  initial: ParentCard[];
  texts: ParentBoardTexts;
  sortScope: SortScope;
  /** Entregas contam "3/4 etapas" porque as próximas ainda vão nascer; um
   *  plano conta só quantas atividades tem. */
  showStepCount: boolean;
}) {
  const router = useRouter();
  // O rótulo do tipo só informa quando há MAIS DE UM tipo na lista. Dentro da
  // aba Entregas, "ADM NORTH · Entrega · etapa 3/4" gasta uma palavra para
  // repetir o nome da aba; o mesmo valia em Plano de Ação. Com dois ou mais
  // tipos (o desenho já prevê outros fluxos) ele volta sozinho, porque aí
  // passa a distinguir de verdade.
  const showTypeLabel = new Set(initial.map((d) => d.typeLabel)).size > 1;
  const [view, setView] = useState<View>("lista");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const { sort, setSort } = useSortPref(sortScope);

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
        <NewTaskButton label={texts.newLabel} className="admin-btn primary kb-newtask-btn" />
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
                      {d.clientName} · {showTypeLabel ? `${d.typeLabel} · ` : ""}
                      {showStepCount
                        ? `etapa ${d.activities.length}/${total}`
                        : `${d.activities.length} atividade${d.activities.length === 1 ? "" : "s"}`}
                      {showStepCount && current ? ` · ${subtypeLabel(current.subtype) || current.title}` : ""}
                    </em>
                    <span className={`plan-acc-description ${d.description ? "" : "is-hint"}`}>
                      {d.description || texts.descriptionHint}
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
    </div>
  );
}
