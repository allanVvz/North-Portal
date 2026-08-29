"use client";

import { useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import { STATUS_LABEL } from "./kanbanShared";
import { FloatingPanel, useDismissOnOutside, useFloatingPopover } from "./FloatingPopover";
import { flowStepKeyOf } from "@/lib/taskRelations";
import type { TaskSubtypeDef, TaskTypeDef } from "@/lib/taskTypes";
import type { TaskRecord } from "@/lib/validation";

// A corrente de uma entrega, com o botão de corrente nas etapas vazias.
//
// Um componente só, usado tanto no card da ENTREGA quanto no card de uma
// ETAPA: quem abre uma etapa pelo quadro precisa enxergar e mexer na corrente
// sem antes descobrir que existe uma tela de Entregas.
//
// A lista vem do TIPO, não dos cards — numa cascata as etapas seguintes ainda
// não existem, e mostrar só o que já nasceu esconderia justamente o que falta.

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
  const { anchorRef, popoverRef, style } = useFloatingPopover(open, "end");
  useDismissOnOutside(open, () => setOpen(false), [anchorRef, popoverRef]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? candidates.filter((c) => c.title.toLowerCase().includes(needle)) : candidates;

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
  onOpenStep,
  onUnlinkStep,
  onLinkStep,
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
  onOpenStep: (task: TaskRecord) => void;
  onUnlinkStep: (task: TaskRecord) => void;
  onLinkStep: (task: TaskRecord, slot: string) => void;
}) {
  return (
    <div className="tm-box tm-planmembers">
      <p className="tm-box-label">
        Etapas{type ? ` · ${type.label}` : ""} ({steps.length}/{type?.subtypes.length ?? steps.length})
      </p>
      <div className="tm-member-list">
        {(type?.subtypes ?? []).map((step) => {
          const card = steps.find((t) => flowStepKeyOf(t) === step.key) ?? null;
          const isCurrent = card?.id === currentTaskId;
          return (
            <div className={`tm-member ${isCurrent ? "tm-member-current" : ""}`} key={step.key}>
              {card ? (
                <>
                  <button
                    type="button"
                    className="tm-member-unlink"
                    title="Desligar este card da entrega"
                    aria-label={`Desligar ${card.title} da entrega`}
                    onClick={() => onUnlinkStep(card)}
                    disabled={busy}
                  >✕</button>
                  <button
                    type="button"
                    className="tm-member-open"
                    onClick={() => onOpenStep(card)}
                    disabled={!canOpen || busy || isCurrent}
                  >
                    <TaskKindIcon kind={card.kind} size="sm" />
                    <span className="tm-member-title">{step.label}</span>
                    <span className="tm-member-status">{isCurrent ? "você está aqui" : STATUS_LABEL[card.status]}</span>
                    {isCurrent ? null : <span className="tm-member-arrow" aria-hidden>↗</span>}
                  </button>
                </>
              ) : (
                <>
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
                    <span className="tm-member-status">Aguardando a etapa anterior</span>
                  </span>
                </>
              )}
            </div>
          );
        })}
        {!type ? <p className="admin-sub" style={{ margin: 0 }}>Carregando etapas…</p> : null}
      </div>
    </div>
  );
}
