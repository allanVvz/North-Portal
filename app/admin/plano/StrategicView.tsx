"use client";

import { useMemo, useState } from "react";
import { STATUS_LABEL, TONES, initials } from "../kanbanShared";
import type { ActionPlan, PlanActivity } from "@/lib/supabase";
import { parseAssignees } from "@/lib/assignees";
import { normalizeSearchText } from "@/lib/taskSearch";
import TaskKindIcon from "../TaskKindIcon";
import { partsLabel, pendingLabel } from "../parentCounts";
import DateRangeField from "../DateRangeField";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "../FloatingPopover";
import {
  EMPTY_STRATEGIC_FILTER,
  filterPlans,
  isFilterActive,
  planPeople,
  shouldAutoExpand,
  whyPreview,
  type StrategicFilter,
} from "./strategicFilters";

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

/** Uma pergunta do cabeçalho virada filtro: rótulo em cima, valor embaixo, e um
 * painel com as respostas que existem nos planos em tela. Free-text e lista
 * convivem — a lista é atalho, não camisa de força (a spec pede editável e
 * autocompletável). */
function QuestionFilter({
  label,
  value,
  summary,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  /** O que mostrar quando não há filtro: o que a tela já contém. */
  summary: string;
  options: { value: string; label: string; hint?: string }[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { anchorRef, popoverRef, style } = useFloatingPopover(open);
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  const needle = normalizeSearchText(value).trim();
  const visible = needle
    ? options.filter((o) => normalizeSearchText(`${o.label} ${o.hint ?? ""}`).includes(needle))
    : options;

  return (
    <div className="plan-qfield" ref={anchorRef}>
      <span className="plan-qlabel">{label}</span>
      <button type="button" className={`plan-qvalue ${value ? "on" : ""}`} onClick={() => setOpen((v) => !v)}>
        {value || summary}
      </button>
      {value ? (
        <button type="button" className="plan-qclear" aria-label={`Limpar filtro ${label}`} onClick={() => onChange("")}>✕</button>
      ) : null}
      <FloatingPanel open={open} popoverRef={popoverRef} style={style} className="plan-qpop">
        <input
          className="plan-qinput"
          value={value}
          placeholder={placeholder}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") setOpen(false); }}
        />
        <div className="plan-qoptions">
          {visible.map((option) => (
            <button
              type="button"
              className="plan-qoption"
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <strong>{option.label}</strong>
              {option.hint ? <small>{option.hint}</small> : null}
            </button>
          ))}
          {visible.length === 0 ? <p className="admin-sub plan-qempty">Nada com esse texto — o filtro vale mesmo assim.</p> : null}
        </div>
      </FloatingPanel>
    </div>
  );
}

// Client is the primary grouping axis — one heading per cliente, plans (and
// their Responsável swimlanes) nested underneath. "Quem, quando, o que vai
// fazer" per plano: one card per plan, its activities grouped into swimlanes
// by Responsável (quem) — each chip shows o que (título/tipo) and quando
// (prazo). Wraps instead of scrolling horizontally so it stays fully
// responsive down to mobile widths.
// Genérico sobre ActionPlan para servir também às Entregas de fluxo, que são
// estruturalmente um plano (mesmo pai, mesmas `activities`) agregado por
// sequência em vez de por composição. Sem isso, os handlers do chamador
// chegariam alargados para ActionPlan e ele perderia os próprios campos.
export default function StrategicView<T extends ActionPlan>({
  plans,
  onOpenPlan,
  onOpenActivity,
  emptyMessage = "Nenhum plano de ação ainda. Crie um card do tipo “Plano de Ação” no Kanban.",
}: {
  plans: T[];
  onOpenPlan: (plan: T) => void;
  onOpenActivity: (plan: T, activityId: string) => void;
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState<StrategicFilter>(EMPTY_STRATEGIC_FILTER);
  const patch = (part: Partial<StrategicFilter>) => setFilter((current) => ({ ...current, ...part }));

  const visible = useMemo(() => filterPlans(plans, filter), [plans, filter]);

  // Recolhido é o padrão porque a tela sem filtro é uma parede de swimlanes de
  // todos os clientes. Abaixo de 5 planos esse motivo evapora e o clique a mais
  // vira pedágio — quem filtrou até aqui filtrou para VER.
  //
  // Por isso o estado é um mapa de EXCEÇÕES, não o conjunto dos abertos: o
  // automático manda enquanto ninguém discordou, e um clique manual vale só
  // para aquele card. Guardar "os abertos" faria a regra automática apagar a
  // escolha da pessoa toda vez que a contagem mudasse.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const autoExpand = shouldAutoExpand(visible.length);
  const isOpen = (id: string) => overrides.get(id) ?? autoExpand;
  const toggle = (id: string) =>
    setOverrides((current) => {
      const next = new Map(current);
      next.set(id, !isOpen(id));
      return next;
    });

  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const p of plans) {
      for (const name of planPeople(p)) {
        const key = name.toLocaleLowerCase("pt-BR");
        if (!names.has(key)) names.set(key, name);
      }
    }
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [plans]);

  const whyOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; hint?: string }>();
    for (const p of plans) {
      const preview = whyPreview(p.description);
      if (!preview || seen.has(preview)) continue;
      seen.set(preview, { value: preview.replace(/…$/, ""), label: preview, hint: p.clientName || undefined });
    }
    return Array.from(seen.values());
  }, [plans]);

  if (plans.length === 0) {
    return <p className="admin-empty">{emptyMessage}</p>;
  }

  const groups = new Map<string, { clientName: string; items: T[] }>();
  for (const p of visible) {
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
      {/* As três perguntas que o cabeçalho já fazia — quem, quando, por quê —
          deixam de ser dica e viram o filtro. Era texto fixo dizendo "defina
          quem assume cada entrega"; agora é onde se pergunta QUEM está com o
          quê, e a lista responde. */}
      <section className="plan-qbar" aria-label="Filtrar planos por quem, quando e por quê">
        <QuestionFilter
          label="Quem"
          value={filter.who}
          summary={people.length ? `${people.length} pessoa${people.length === 1 ? "" : "s"} nos planos` : "Sem responsáveis"}
          options={people.map((name) => ({ value: name, label: name }))}
          placeholder="Buscar responsável…"
          onChange={(who) => patch({ who })}
        />
        <div className="plan-qfield">
          <span className="plan-qlabel">Quando</span>
          <DateRangeField
            from={filter.from}
            to={filter.to}
            onChange={(from, to) => patch({ from, to })}
            presets={[30, 90]}
            activePreset={null}
            presetLabel={(days) => `Próximos ${days} dias`}
            placeholder="Qualquer período"
            onPreset={(days) => {
              // Plano olha para a frente: "30 dias" aqui é o que vem, não o que
              // passou (em Performance o mesmo botão significa o contrário — por
              // isso o rótulo é explícito).
              const today = new Date();
              const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const end = new Date(today);
              end.setDate(end.getDate() + days);
              patch({ from: iso(today), to: iso(end) });
            }}
          />
          {filter.from || filter.to ? (
            <button type="button" className="plan-qclear" aria-label="Limpar filtro Quando" onClick={() => patch({ from: "", to: "" })}>✕</button>
          ) : null}
        </div>
        <QuestionFilter
          label="Por quê"
          value={filter.why}
          summary="Qualquer justificativa"
          options={whyOptions}
          placeholder="Buscar na justificativa…"
          onChange={(why) => patch({ why })}
        />
      </section>

      {isFilterActive(filter) ? (
        <p className="plan-qresult" role="status">
          {visible.length === 0
            ? "Nenhum plano com esses filtros."
            : `${visible.length} de ${plans.length} plano${plans.length === 1 ? "" : "s"}${autoExpand ? " · abertos automaticamente" : ""}`}
          <button type="button" className="admin-btn ghost" onClick={() => setFilter(EMPTY_STRATEGIC_FILTER)}>Limpar filtros</button>
        </p>
      ) : null}
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

              const open = isOpen(p.id);

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
                        {/* Entrega conta pelo MOLDE ("etapa 2/4"), plano conta o que
                            tem. Esta tela dizia "N atividades" para os dois, o que fazia
                            uma entrega com só o roteiro pronto parecer um plano de um
                            item — completo. */}
                        <span className="plan-strat-count">{partsLabel(p)}</span>
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

                  {/* O que ainda VAI nascer. Sem esta linha a entrega parece
                      terminada quando só a primeira etapa existe — as outras não
                      são cards ainda, então não aparecem em raia nenhuma. */}
                  {pendingLabel(p) ? (
                    <p className="admin-sub plan-strat-pending">
                      {pendingLabel(p)} — cada uma nasce quando a anterior é concluída.
                    </p>
                  ) : null}
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
