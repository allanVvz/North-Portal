"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import { STATUS_LABEL } from "../kanbanShared";
import PlanSearchBar from "./PlanSearchBar";
import StrategicView, { fmtDate } from "./StrategicView";
import { kindLabel, kindTone } from "@/lib/taskCatalog";
import type { ActionPlan } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

type View = "lista" | "estrategica";

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

export default function ActionPlansBoard({ initial }: { initial: ActionPlan[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("estrategica");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActionPlan | null>(null);

  const plans = useMemo(() => {
    const needle = q.trim();
    return needle ? initial.filter((p) => planMatches(p, needle)) : initial;
  }, [initial, q]);

  // The plan card as a TaskRecord for the editor modal.
  const asTask = (p: ActionPlan): TaskRecord => {
    // Strip the accordion-only fields; the rest is a genuine TaskRecord.
    const { clientName: _c, clientSlug: _s, progress: _p, activities: _a, ...task } = p;
    void _c; void _s; void _p; void _a;
    return task;
  };

  return (
    <div className="ap">
      <div className="ap-filters">
        <div className="kb-viewtabs">
          <button className={view === "estrategica" ? "on" : ""} onClick={() => setView("estrategica")}>Estratégica</button>
          <button className={view === "lista" ? "on" : ""} onClick={() => setView("lista")}>Lista</button>
        </div>
        <PlanSearchBar q={q} onQChange={setQ} plans={initial} />
      </div>

      {view === "estrategica" ? (
        <StrategicView plans={plans} onOpenPlan={setEditing} />
      ) : plans.length === 0 ? (
        <p className="admin-empty">Nenhum plano de ação ainda. Crie um card do tipo “Plano de Ação” no Kanban.</p>
      ) : (
        <div className="plan-acc">
          {plans.map((p) => {
            const open = openId === p.id;
            return (
              <div className={`plan-acc-item ${open ? "open" : ""}`} key={p.id}>
                <button className="plan-acc-head" onClick={() => setOpenId(open ? null : p.id)}>
                  <span className={`plan-acc-caret ${open ? "on" : ""}`}>▸</span>
                  <span className="plan-acc-title">
                    <strong>{p.title}</strong>
                    <em>{p.clientName} · {p.activities.length} atividade{p.activities.length === 1 ? "" : "s"}</em>
                  </span>
                  <span className="plan-acc-progress">
                    <span className="plan-acc-bar"><span className="plan-acc-fill" style={{ width: `${p.progress}%` }} /></span>
                    <b>{p.progress}%</b>
                  </span>
                </button>

                {open ? (
                  <div className="plan-acc-body">
                    <div className="plan-acc-actions">
                      <button className="admin-btn ghost sm" onClick={() => setEditing(p)}>Abrir card</button>
                      <button className="admin-btn primary sm" onClick={() => setEditing(p)}>Editar</button>
                    </div>
                    {p.activities.length === 0 ? (
                      <p className="admin-sub">Nenhuma atividade vinculada. Vincule tarefas a este plano no card (atributo “Plano de Ação”).</p>
                    ) : (
                      <ul className="plan-acc-list">
                        {p.activities.map((a) => (
                          <li key={a.id}>
                            <span className={`kb-type t-tone-${kindTone(a.kind)}`}>{kindLabel(a.kind)}</span>
                            <span className="plan-acc-actitle">{a.title}</span>
                            <span className="plan-acc-status">{STATUS_LABEL[a.status]}</span>
                            <span className="plan-acc-actpct">{a.progress}%</span>
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
          task={asTask(editing)}
          clientName={editing.clientName}
          clientSlug={editing.clientSlug}
          onClose={() => { setEditing(null); router.refresh(); }}
          onSaved={() => { setEditing(null); router.refresh(); }}
          onDeleted={() => { setEditing(null); router.refresh(); }}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
