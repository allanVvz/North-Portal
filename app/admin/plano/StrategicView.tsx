"use client";

import { useState } from "react";
import { STATUS_LABEL, TONES, initials } from "../kanbanShared";
import type { ActionPlan, PlanActivity } from "@/lib/supabase";
import { parseAssignees } from "@/lib/assignees";
import TaskKindIcon from "../TaskKindIcon";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtDate(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  return `${Number(m[3])} ${MES[Number(m[2]) - 1]}`;
}

// Bucket key for activities without an assignee — always sorted last.
const NO_ASSIGNEE = "__sem__";
const NO_CLIENT = "__sem_cliente__";

// Stable per-person accent so the same Responsável always gets the same tone
// across plans — reinforces "quem" as the primary grouping at a glance.
function toneFor(who: string): (typeof TONES)[number] {
  if (who === NO_ASSIGNEE) return "neutral";
  let h = 0;
  for (let i = 0; i < who.length; i++) h = (h * 31 + who.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

// Client is the primary grouping axis — one heading per cliente, plans (and
// their Responsável swimlanes) nested underneath. "Quem, quando, o que vai
// fazer" per plano: one card per plan, its activities grouped into swimlanes
// by Responsável (quem) — each chip shows o que (título/tipo) and quando
// (prazo). Wraps instead of scrolling horizontally so it stays fully
// responsive down to mobile widths.
export default function StrategicView({
  plans,
  onOpenPlan,
  onOpenActivity,
}: {
  plans: ActionPlan[];
  onOpenPlan: (plan: ActionPlan) => void;
  onOpenActivity: (plan: ActionPlan, activityId: string) => void;
}) {
  // Todo plano nasce recolhido — a tela abria como uma parede de swimlanes de
  // todos os clientes ao mesmo tempo. Um Set (e não um único id) porque
  // comparar dois planos lado a lado é o uso normal desta visão.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  if (plans.length === 0) {
    return <p className="admin-empty">Nenhum plano de ação ainda. Crie um card do tipo “Plano de Ação” no Kanban.</p>;
  }

  const groups = new Map<string, { clientName: string; items: ActionPlan[] }>();
  for (const p of plans) {
    const key = p.clientSlug || NO_CLIENT;
    const g = groups.get(key);
    if (g) g.items.push(p); else groups.set(key, { clientName: p.clientName || "Sem cliente", items: [p] });
  }
  const groupEntries = Array.from(groups.entries()).sort(([ka, a], [kb, b]) => {
    if (ka === NO_CLIENT) return 1;
    if (kb === NO_CLIENT) return -1;
    return a.clientName.localeCompare(b.clientName);
  });

  return (
    <div className="plan-strat">
      <section className="plan-guide" aria-label="Guia do plano de ação">
        <div><span>Quem</span><strong>Defina quem assume cada entrega.</strong></div>
        <div><span>Quando</span><strong>Use início, fim e prazos objetivos.</strong></div>
        <div><span>Por quê</span><strong>Registre o resultado esperado na descrição.</strong></div>
      </section>
      {groupEntries.map(([key, group]) => (
        <div className="plan-strat-group" key={key}>
          <h2 className="plan-strat-groupname">{group.clientName}</h2>
          <div className="plan-strat-groupitems">
            {group.items.map((p) => {
              const lanes = new Map<string, PlanActivity[]>();
              for (const a of p.activities) {
                const owners = parseAssignees(a.assignee);
                for (const laneKey of owners.length ? owners : [NO_ASSIGNEE]) {
                  const list = lanes.get(laneKey);
                  if (list) list.push(a); else lanes.set(laneKey, [a]);
                }
              }
              const laneEntries = Array.from(lanes.entries()).sort(([a], [b]) => {
                if (a === NO_ASSIGNEE) return 1;
                if (b === NO_ASSIGNEE) return -1;
                return a.localeCompare(b);
              });

              const open = expanded.has(p.id);

              return (
                <div className={`plan-strat-card ${open ? "open" : ""}`} key={p.id}>
                  {/* O cabeçalho alterna a expansão (é o gesto pedido); abrir o
                      plano no modal continua acessível pelo botão "Abrir" ao
                      lado do progresso — aninhar um botão dentro do outro seria
                      HTML inválido. */}
                  <div className="plan-strat-headrow">
                    <button
                      type="button"
                      className="plan-strat-headtoggle"
                      aria-expanded={open}
                      onClick={() => toggle(p.id)}
                    >
                      <span className={`plan-acc-caret ${open ? "on" : ""}`} aria-hidden>▸</span>
                      <span className="plan-strat-headtext">
                        <span className="plan-card-titleline"><TaskKindIcon kind={p.kind} size="lg" /><strong>{p.title}</strong></span>
                        <span className="plan-strat-count">{p.activities.length} atividade{p.activities.length === 1 ? "" : "s"}</span>
                        <span className="plan-strat-description">{p.description || "Descreva o motivo, o resultado esperado e como saberemos que o plano funcionou."}</span>
                      </span>
                    </button>
                    <span className="plan-strat-progress">
                      <span className="plan-strat-bar"><span className="plan-strat-fill" style={{ width: `${p.progress}%` }} /></span>
                      <b>{p.progress}%</b>
                    </span>
                    <button type="button" className="admin-btn ghost plan-strat-open" onClick={() => onOpenPlan(p)}>Abrir</button>
                  </div>

                  {open ? (
                  <>
                  <div className="plan-strat-questions">
                    <div><span>Quem</span><strong>{p.assignee || "Responsáveis das atividades"}</strong></div>
                    <div><span>Quando</span><strong>{fmtDate(p.start_date)} → {fmtDate(p.end_date)}</strong></div>
                    <div><span>Por quê</span><strong>{p.description || "Objetivo ainda não descrito"}</strong></div>
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
                              <span className="plan-strat-lane-eyebrow">Quem</span>
                              <span className="plan-strat-lane-name">{who === NO_ASSIGNEE ? "Sem responsável" : who}</span>
                            </span>
                            <span className="plan-strat-lane-count">{items.length}</span>
                          </div>
                          <div className="plan-strat-chips">
                            {items.map((a) => (
                              <button
                                type="button"
                                className="plan-strat-chip"
                                key={a.id}
                                title={a.title}
                                onClick={() => onOpenActivity(p, a.id)}
                              >
                                <span className="plan-strat-chiptitle"><TaskKindIcon kind={a.kind} /><span><small>O quê</small>{a.title}</span></span>
                                <span className="plan-strat-chipmeta">
                                  <span className="plan-strat-chipdue"><small>Quando</small>{fmtDate(a.due_date)}</span>
                                  <span className="plan-strat-chipstatus">{STATUS_LABEL[a.status]}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
