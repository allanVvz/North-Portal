"use client";

import { STATUS_LABEL, TONES, initials, kindLabel, kindTone } from "../kanbanShared";
import type { ActionPlan, PlanActivity } from "@/lib/supabase";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  return `${Number(m[3])} ${MES[Number(m[2]) - 1]}`;
}

// Bucket key for activities without an assignee — always sorted last.
const NO_ASSIGNEE = "__sem__";

// Stable per-person accent so the same Responsável always gets the same tone
// across plans — reinforces "quem" as the primary grouping at a glance.
function toneFor(who: string): (typeof TONES)[number] {
  if (who === NO_ASSIGNEE) return "neutral";
  let h = 0;
  for (let i = 0; i < who.length; i++) h = (h * 31 + who.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

// "Quem, quando, o que vai fazer" per plano: one card per plan, its activities
// grouped into swimlanes by Responsável (quem) — each chip shows o que
// (título/tipo) and quando (prazo). Wraps instead of scrolling horizontally so
// it stays fully responsive down to mobile widths.
export default function StrategicView({ plans, onOpenPlan }: { plans: ActionPlan[]; onOpenPlan: (plan: ActionPlan) => void }) {
  if (plans.length === 0) {
    return <p className="admin-empty">Nenhum plano de ação ainda. Crie um card do tipo “Plano de Ação” no Kanban.</p>;
  }
  return (
    <div className="plan-strat">
      {plans.map((p) => {
        const lanes = new Map<string, PlanActivity[]>();
        for (const a of p.activities) {
          const key = a.assignee?.trim() || NO_ASSIGNEE;
          const list = lanes.get(key);
          if (list) list.push(a); else lanes.set(key, [a]);
        }
        const laneEntries = Array.from(lanes.entries()).sort(([a], [b]) => {
          if (a === NO_ASSIGNEE) return 1;
          if (b === NO_ASSIGNEE) return -1;
          return a.localeCompare(b);
        });

        return (
          <div className="plan-strat-card" key={p.id}>
            <div className="plan-strat-headrow">
              <div className="plan-strat-headtext">
                <strong>{p.title}</strong>
                <em>
                  {p.clientName} · {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
                  {p.assignee ? <> · <b className="plan-strat-owner">Responsável: {p.assignee}</b></> : null}
                </em>
              </div>
              <span className="plan-strat-progress">
                <span className="plan-strat-bar"><span className="plan-strat-fill" style={{ width: `${p.progress}%` }} /></span>
                <b>{p.progress}%</b>
              </span>
              <button className="admin-btn ghost sm" onClick={() => onOpenPlan(p)}>Abrir plano</button>
            </div>

            {laneEntries.length === 0 ? (
              <p className="admin-sub plan-strat-empty">Nenhuma atividade vinculada ainda.</p>
            ) : (
              <div className="plan-strat-lanes">
                {laneEntries.map(([who, items]) => (
                  <div className={`plan-strat-lane plan-strat-lane-tone-${toneFor(who)}`} key={who}>
                    <div className="plan-strat-lane-head">
                      <span className="plan-strat-avatar" aria-hidden>{who === NO_ASSIGNEE ? "—" : initials(who)}</span>
                      <span className="plan-strat-lane-who">
                        <span className="plan-strat-lane-eyebrow">Responsável</span>
                        <span className="plan-strat-lane-name">{who === NO_ASSIGNEE ? "Sem responsável" : who}</span>
                      </span>
                      <span className="plan-strat-lane-count">{items.length}</span>
                    </div>
                    <div className="plan-strat-chips">
                      {items.map((a) => (
                        <div className="plan-strat-chip" key={a.id} title={a.title}>
                          <span className={`kb-type t-tone-${kindTone(a.kind)}`}>{kindLabel(a.kind)}</span>
                          <span className="plan-strat-chiptitle">{a.title}</span>
                          <span className="plan-strat-chipmeta">
                            <span className="plan-strat-chipdue">{fmtDate(a.due_date)}</span>
                            <span className="plan-strat-chipstatus">{STATUS_LABEL[a.status]}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
