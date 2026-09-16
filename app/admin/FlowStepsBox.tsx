"use client";

import { useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import StepRow, { type StepPatch } from "./StepRow";
import { STATUS_LABEL } from "./kanbanShared";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";
import { flowStepKeyOf } from "@/lib/taskRelations";
import { taskMatchesQuery } from "@/lib/taskSearch";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import type { TaskSubtypeDef, TaskTypeDef } from "@/lib/taskTypes";
import type { ReviewerCandidate, TaskRecord } from "@/lib/validation";

// A corrente de uma entrega, com o botão de corrente nas etapas vazias.
//
// Um componente só, usado tanto no card da ENTREGA quanto no card de uma
// ETAPA: quem abre uma etapa pelo quadro precisa enxergar e mexer na corrente
// sem antes descobrir que existe uma tela de Entregas.
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
  step: TaskSubtypeDef;
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
  candidatesFor: (slot: string) => TaskRecord[];
  busy: boolean;
  canOpen: boolean;
  /** Quem pode ser responsável por uma etapa (a equipe). */
  team: ReviewerCandidate[];
  onOpenStep: (task: TaskRecord) => void;
  onUnlinkStep: (task: TaskRecord) => void;
  onLinkStep: (task: TaskRecord, slot: string) => void;
  onPatchStep: (task: TaskRecord, patch: StepPatch) => Promise<void>;
  onCommentStep: (task: TaskRecord, text: string) => Promise<void>;
}) {
  const current = currentFlowStepOf(steps);

  // Fluxo DINÂMICO (tipo existe mas não tem subtipos — ex.: ocorrência
  // `operacional` promovida a pai de fluxo): não há sequência pré-definida, só
  // as etapas que existem.
  // Uma Entrega de relatório tem etapas criadas pela automação, não pelo
  // vocabulário estático. Quando o tipo não chegou (ou é legado inativo), os
  // filhos ligados ainda são a fonte de verdade e nunca devem parecer loading.
  const dynamic = (type !== null && type.subtypes.length === 0) || (type === null && steps.length > 0);
  if (dynamic) {
    if (!steps.length) return null;
    return (
      <div className="tm-box tm-planmembers">
        <p className="tm-box-label">Etapas ({steps.length})</p>
        <div className="tm-member-list">
          {steps.map((card) => (
            <StepRow
              key={card.id}
              card={card}
              label={card.title}
              isCurrent={current?.id === card.id}
              isOpenCard={card.id === currentTaskId}
              team={team}
              busy={busy}
              canOpen={canOpen}
              onOpen={() => onOpenStep(card)}
              onPatch={onPatchStep}
              onComment={onCommentStep}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="tm-box tm-planmembers">
      <p className="tm-box-label">
        Etapas{type ? ` · ${type.label}` : ""} ({steps.length}/{type?.subtypes.length ?? steps.length})
      </p>
      <div className="tm-member-list">
        {(type?.subtypes ?? []).map((step) => {
          const card = steps.find((t) => flowStepKeyOf(t) === step.key) ?? null;
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
                candidates={candidatesFor(step.key)}
                busy={busy}
                onPick={(task) => onLinkStep(task, step.key)}
              />
              <span className="tm-member-open tm-member-pending">
                <TaskKindIcon kind={type?.key ?? "operacional"} size="sm" />
                <span className="tm-member-title">{step.label}</span>
                <span className="tm-member-status">
                  Nasce quando a anterior for concluída{step.lead_days ? ` · prazo de ${step.lead_days} dia${step.lead_days === 1 ? "" : "s"}` : ""}
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
