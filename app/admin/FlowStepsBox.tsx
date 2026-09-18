"use client";

import { useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import StepRow, { type StepPatch } from "./StepRow";
import { STATUS_LABEL } from "./kanbanShared";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";
import { taskMatchesQuery } from "@/lib/taskSearch";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import type { TaskTypeDef, WorkflowStepDef } from "@/lib/taskTypes";
import type { ReviewerCandidate, TaskRecord } from "@/lib/validation";

// A corrente de uma entrega, com o botão de corrente nas etapas vazias.
//
// Este é contexto e controle exclusivos do card agregador ENTREGA. Uma etapa
// mostra apenas seus pais em "Faz parte de" no TaskModal: não pode listar,
// editar, comentar, vincular ou desvincular os próprios irmãos.
//
// A lista vem do TIPO, não dos cards — numa cascata as etapas seguintes ainda
// não existem, e mostrar só o que já nasceu esconderia justamente o que falta.
//
// Cada etapa que já existe é editável na linha (StepRow): check de concluir,
// status, data prevista, responsável e os comentários dela — sem abrir o card.
// A "etapa atual" é marcada, e é ela que o card pai espelha.

function ChainPicker({
  step,
  candidates,
  busy,
  onPick,
}: {
  step: WorkflowStepDef;
  candidates: TaskRecord[];
  busy: boolean;
  onPick: (task: TaskRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // "start": o 🔗 fica na borda ESQUERDA da linha da etapa, então alinhar pela
  // direita jogaria os 320px do painel todos para fora do modal. Alinhado pelo
  // início, ele desce rente à coluna em que o botão está.
  const { anchorRef, popoverRef, style } = useFloatingPopover(open, "start");
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  const shown = q.trim() ? candidates.filter((c) => taskMatchesQuery(c, q)) : candidates;

  return (
    <div className="tm-chain" ref={anchorRef}>
      <button
        type="button"
        className="tm-member-unlink tm-member-chain"
        title={`Ligar um card existente à etapa ${step.label}`}
        aria-label={`Ligar um card existente à etapa ${step.label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >🔗</button>

      <FloatingPanel open={open} popoverRef={popoverRef} style={style} className="tm-chain-panel">
        <p className="tm-chain-title">Ligar um card à etapa {step.label}</p>
        <input
          className="tm-chain-search"
          placeholder="Buscar card…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="tm-chain-list">
          {shown.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className="tm-chain-option"
              onClick={() => { setOpen(false); onPick(candidate); }}
              disabled={busy}
            >
              <TaskKindIcon kind={candidate.kind} size="sm" />
              <span className="tm-chain-option-title">{candidate.title}</span>
              <span className="tm-chain-option-status">{STATUS_LABEL[candidate.status]}</span>
            </button>
          ))}
          {shown.length === 0 ? (
            <p className="admin-sub tm-chain-empty">
              {candidates.length === 0
                ? `Nenhum card de ${step.label} neste cliente. Esta etapa também nasce sozinha quando a anterior é concluída.`
                : "Nenhum card para essa busca."}
            </p>
          ) : null}
        </div>
      </FloatingPanel>
    </div>
  );
}

export default function FlowStepsBox({
  type,
  steps,
  currentTaskId,
  candidatesFor,
  busy,
  canOpen,
  team,
  onOpenStep,
  onUnlinkStep,
  onLinkStep,
  onPatchStep,
  onCommentStep,
}: {
  /** O tipo-entrega, que é quem declara as etapas e a ordem delas. */
  type: TaskTypeDef | null;
  /** Os cards que já ocupam alguma etapa desta entrega. */
  steps: TaskRecord[];
  /** Card aberto no momento, para destacar "você está aqui". */
  currentTaskId: string | null;
  candidatesFor: (taskTypeId: string) => TaskRecord[];
  busy: boolean;
  canOpen: boolean;
  /** Quem pode ser responsável por uma etapa (a equipe). */
  team: ReviewerCandidate[];
  onOpenStep: (task: TaskRecord) => void;
  onUnlinkStep: (task: TaskRecord) => void;
  onLinkStep: (task: TaskRecord, workflowStepId: string) => void;
  onPatchStep: (task: TaskRecord, patch: StepPatch) => Promise<void>;
  onCommentStep: (task: TaskRecord, text: string) => Promise<void>;
}) {
  const current = currentFlowStepOf(steps);

  // A lista planejada vem exclusivamente da versão publicada/persistida.
  const plannedSteps = type && type.workflowSteps.length > 0 ? type.workflowSteps : null;

  // Sem a versão carregada não há denominador legítimo: não derive estrutura
  // dos cards materializados.
  if (!plannedSteps) {
    return type === null
      ? <div className="tm-box tm-planmembers"><p className="admin-sub" style={{ margin: 0 }}>Carregando etapas…</p></div>
      : null;
  }

  return (
    <div className="tm-box tm-planmembers">
      <p className="tm-box-label">
        Etapas ({steps.length}/{plannedSteps.length})
      </p>
      <div className="tm-member-list">
        {plannedSteps.map((step) => {
          const card = steps.find((task) => task.parents.some((parent) => parent.workflow_step_id === step.workflow_step_id)) ?? null;
          if (card) {
            return (
              <StepRow
                key={step.key}
                card={card}
                label={step.label}
                isCurrent={current?.id === card.id}
                isOpenCard={card.id === currentTaskId}
                team={team}
                busy={busy}
                canOpen={canOpen}
                onOpen={() => onOpenStep(card)}
                onUnlink={() => onUnlinkStep(card)}
                unlinkTitle={`Desligar ${card.title} da entrega`}
                onPatch={onPatchStep}
                onComment={onCommentStep}
              />
            );
          }
          return (
            <div className="tm-member tm-step-pending" key={step.key}>
              {/* Ligar compartilha, não copia: é assim que o mesmo roteiro
                  serve três peças e uma diária de gravação serve vários
                  criativos. */}
              <ChainPicker
                step={step}
                candidates={candidatesFor(step.task_type_id)}
                busy={busy}
                onPick={(task) => onLinkStep(task, step.workflow_step_id)}
              />
              <span className="tm-member-open tm-member-pending">
                {/* Etapas de relatório nascem sempre `operacional` (ver
                    ensureFlowStep) — nunca do kind da entrega ("criativo"). */}
                <TaskKindIcon kind="operacional" size="sm" />
                <span className="tm-member-title">{step.label}</span>
                <span className="tm-member-status">
                  {step.creation_trigger === "ads_report_approved"
                    ? "Nasce quando o Relatório de anúncios for aprovado"
                    : step.creation_trigger === "feedback_approved"
                      ? "Nasce quando o Feedback for aprovado"
                      : step.creation_trigger === "delivery_created"
                        ? "É criada junto com a Entrega"
                        : "Nasce quando a etapa anterior for aprovada"}
                  {step.lead_days ? ` · prazo de ${step.lead_days} dia${step.lead_days === 1 ? "" : "s"}` : ""}
                </span>
              </span>
            </div>
          );
        })}
        {!type ? <p className="admin-sub" style={{ margin: 0 }}>Carregando etapas…</p> : null}
      </div>
    </div>
  );
}
