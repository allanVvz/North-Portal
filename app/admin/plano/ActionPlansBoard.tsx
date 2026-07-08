"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import CardModalLauncher from "../CardModalLauncher";
import { STATUS_LABEL } from "../kanbanShared";
import { kindLabel, kindTone } from "@/lib/taskCatalog";
import type { ActionPlan } from "@/lib/supabase";
import type { TaskRecord } from "@/lib/validation";

type ClientLite = { slug: string; name: string };

export default function ActionPlansBoard({ initial, clients }: { initial: ActionPlan[]; clients: ClientLite[] }) {
  const router = useRouter();
  const [clientFilter, setClientFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActionPlan | null>(null);

  const plans = useMemo(
    () => (clientFilter ? initial.filter((p) => p.clientSlug === clientFilter) : initial),
    [initial, clientFilter],
  );

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
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="ap-clientfilter">
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      {plans.length === 0 ? (
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
