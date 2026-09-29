"use client";

import { useEffect, useState } from "react";
import type { ClientInsight } from "@/lib/insights/clientInsights";

import { currentFlowStepOf } from "@/lib/flows/currentStep";
import { childrenByParent, flowStepsOf, isFlowDelivery, parentIdsOf, recurrenceParentIdOf, relationKindOf } from "@/lib/taskRelations";
import { subtypeLabel } from "@/lib/taskCatalog";
import type { TaskRecord } from "@/lib/validation";
import { operationState, type OperationLevel } from "./operacao/operationItems";

// O contexto do card, no topo do modal (29/09). Três respostas antes de
// qualquer campo:
//   1. ONDE ele mora — a trilha cliente › rotina › entrega/plano › card, cada
//      nível clicável. Antes só havia "← voltar", sem dizer para onde;
//   2. EM QUE PÉ está — o mesmo estado único dos cards da Operação;
//   3. O CAMINHO — numa entrega ou numa etapa, as etapas em sequência, com a
//      atual marcada, clicáveis.
// Só leitura e navegação: nenhum campo é editado aqui.

type Crumb = { id: string | null; label: string; hint?: string };

function levelOf(task: TaskRecord): OperationLevel {
  if (task.kind === "plano_acao") return "plano";
  if (isFlowDelivery(task)) return "entrega";
  return "tarefa";
}

function shortDay(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}`;
}

function stepName(step: TaskRecord): string {
  return subtypeLabel(step.subtype) || step.title.split("—").at(-1)?.trim() || step.title;
}

/** O pai estrutural mais próximo: a entrega de uma etapa, o plano de um membro,
 *  o molde de uma execução. */
function parentOf(task: TaskRecord, byId: Map<string, TaskRecord>): { parent: TaskRecord | null; id: string | null; kind: "entrega" | "plano" | "rotina" | null } {
  const links = task.parents ?? [];
  const step = links.find((link) => relationKindOf(link) === "workflow_step");
  if (step) return { parent: byId.get(step.id) ?? null, id: step.id, kind: "entrega" };
  const owner = parentIdsOf(task)[0] ?? task.plan_id ?? null;
  if (owner) return { parent: byId.get(owner) ?? null, id: owner, kind: "plano" };
  const mold = recurrenceParentIdOf(task);
  if (mold) return { parent: byId.get(mold) ?? null, id: mold, kind: "rotina" };
  return { parent: null, id: null, kind: null };
}

const REPORT_SUBTYPES = new Set(["relatorio_anuncios", "feedback", "relatorio_conversao"]);

/** O dia anterior (o período do relatório termina na véspera da execução). */
function dayBefore(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export default function ModalContext({ task, clientName, clientSlug, clientTasks, today, onOpen }: {
  task: TaskRecord;
  clientName: string;
  clientSlug?: string;
  clientTasks: readonly TaskRecord[];
  today: string;
  onOpen?: (task: TaskRecord) => void;
}) {
  const byId = new Map(clientTasks.map((row) => [row.id, row]));
  byId.set(task.id, task);

  // Trilha: sobe até 3 níveis acima do card.
  const crumbs: Crumb[] = [];
  let cursor: TaskRecord | null = task;
  const seen = new Set<string>([task.id]);
  for (let depth = 0; cursor && depth < 3; depth += 1) {
    const { parent, id, kind } = parentOf(cursor, byId);
    // Pai ainda não carregado: melhor omitir o nível do que mostrar um rótulo
    // genérico ("Plano") que pode estar errado.
    if (!id || !parent || seen.has(id)) break;
    seen.add(id);
    const occurrenceDay = typeof cursor.payload?.occurrence_date === "string" ? cursor.payload.occurrence_date : null;
    const label = parent?.title ?? (kind === "rotina" ? "Rotina" : kind === "plano" ? "Plano" : "Entrega");
    crumbs.unshift({ id: parent ? id : null, label, hint: kind === "rotina" && occurrenceDay ? `semana de ${shortDay(occurrenceDay)}` : undefined });
    cursor = parent;
  }
  crumbs.unshift({ id: null, label: clientName || "Sem cliente" });

  // Estado único, com os filhos que o modal já carregou.
  const level = levelOf(task);
  const members = level === "entrega" ? flowStepsOf(task.id, clientTasks) : level === "plano" ? childrenByParent(clientTasks).get(task.id) ?? [] : [];
  const state = operationState({ id: task.id, task, clientName, clientSlug: "", routine: false, level, members }, today);

  // O caminho: as etapas da entrega (a própria, ou a de que esta etapa faz parte).
  const stepParent = (task.parents ?? []).find((link) => relationKindOf(link) === "workflow_step")?.id ?? null;
  const deliveryId = level === "entrega" ? task.id : stepParent;
  const steps = deliveryId ? flowStepsOf(deliveryId, clientTasks) : [];
  const delivery = deliveryId ? byId.get(deliveryId) ?? null : null;
  const total = Math.max(delivery?.workflow_version?.workflow_version_steps.length ?? 0, steps.length);
  const current = currentFlowStepOf(steps);

  // Dados recebidos na semana desta Entrega de relatório: o que a automação e
  // o Feedback já gravaram (seguidores, alcance, PDF). Liga o card aos números.
  const isReport = REPORT_SUBTYPES.has(task.subtype ?? "") || steps.some((step) => REPORT_SUBTYPES.has(step.subtype ?? ""));
  const occurrenceDay = (() => {
    const holder = delivery ?? task;
    const day = holder.payload?.occurrence_date;
    return typeof day === "string" ? day : null;
  })();
  // Guardado com o slug de origem: ao trocar de card (outro cliente), o número
  // do cliente anterior nunca aparece enquanto o novo carrega.
  const [loaded, setLoaded] = useState<{ slug: string; insight: ClientInsight | null } | null>(null);
  const insight = isReport && loaded && loaded.slug === clientSlug ? loaded.insight : null;
  useEffect(() => {
    if (!isReport || !clientSlug) return;
    let active = true;
    fetch(`/api/admin/insights/clients?slug=${encodeURIComponent(clientSlug)}&weeks=4`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { insights?: ClientInsight[] } | null) => { if (active) setLoaded({ slug: clientSlug, insight: data?.insights?.[0] ?? null }); })
      .catch(() => {});
    return () => { active = false; };
  }, [isReport, clientSlug]);
  const periodTo = occurrenceDay ? dayBefore(occurrenceDay) : null;
  const week = insight && periodTo ? insight.media.find((row) => row.periodTo === periodTo) ?? null : null;
  const followersWeek = insight && periodTo ? insight.followers.find((row) => row.periodTo === periodTo) ?? null : null;
  const received = [
    followersWeek?.gain !== null && followersWeek?.gain !== undefined ? `+${followersWeek.gain.toLocaleString("pt-BR")} seguidores` : "",
    followersWeek?.total ? `${followersWeek.total.toLocaleString("pt-BR")} no perfil` : "",
    week?.reach ? `alcance ${week.reach.toLocaleString("pt-BR")}${week.reachCorrected ? " (corrigido)" : ""}` : "",
    week?.outcomeValue !== null && week?.outcomeValue !== undefined ? `${week.outcomeValue.toLocaleString("pt-BR")} ${week.outcomeLabel.toLowerCase()}` : "",
  ].filter(Boolean);
  const weekPdf = insight && periodTo ? insight.reports.find((report) => report.date === periodTo && report.kind === "anuncios") ?? null : null;

  return (
    <div className="tm-context">
      <nav className="tm-trail" aria-label="Onde este card está">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.id ?? "c"}-${index}`} className="tm-trail-item">
            {index > 0 ? <span className="tm-trail-sep" aria-hidden>/</span> : null}
            {crumb.id && onOpen ? (
              <button type="button" onClick={() => { const target = byId.get(crumb.id!); if (target) onOpen(target); }}>{crumb.label}</button>
            ) : <span>{crumb.label}</span>}
            {crumb.hint ? <em>{crumb.hint}</em> : null}
          </span>
        ))}
        <span className="tm-trail-item is-here"><span className="tm-trail-sep" aria-hidden>/</span><b>{level === "tarefa" && stepParent ? stepName(task) : task.title}</b></span>
      </nav>
      <p className={`tm-state tone-${state.tone}`}>
        <span className={`op-dot tone-${state.tone}`} aria-hidden />
        <b>{state.stage}</b>{state.detail ? <em>· {state.detail}</em> : null}
      </p>
      {received.length || weekPdf ? (
        <p className="tm-received">
          <span className="tm-received-label">Dados da semana</span>
          {received.join(" · ") || "ainda sem dados"}
          {weekPdf ? <a href={weekPdf.url} target="_blank" rel="noreferrer">PDF de anúncios ↗</a> : null}
        </p>
      ) : null}
      {total > 1 ? (
        <ol className="tm-path" aria-label="Etapas">
          {Array.from({ length: total }, (_, index) => {
            const step = steps[index];
            const done = Boolean(step && (step.completed_at || step.status === "aprovado"));
            const now = Boolean(step && current && step.id === current.id && !done);
            const here = step?.id === task.id;
            return (
              <li key={step?.id ?? `futuro-${index}`} className={`${done ? "done" : now ? "now" : "todo"}${here ? " here" : ""}`}>
                {step && onOpen && !here ? (
                  <button type="button" onClick={() => onOpen(step)}><b>{index + 1}</b> {stepName(step)}</button>
                ) : (
                  <span><b>{index + 1}</b> {step ? stepName(step) : "a criar"}</span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
