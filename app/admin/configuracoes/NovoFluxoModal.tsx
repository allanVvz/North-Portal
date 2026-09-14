"use client";

import { useState } from "react";
import { EMPTY_STEP, StepEditor, type StepDraft } from "./FluxosPanel";
import type { TaskTypeEditorNode } from "@/lib/taskTypes";

// Modal de criação de um TIPO de topo novo (reels, carrossel, automação...) —
// o pedaço que faltava pra "criar um fluxo em cascata pela tela" funcionar
// sem mudança de código (2026-09-13). Monta o tipo E as etapas dele numa
// tacada só: nada é gravado até o "Criar fluxo" final — arrastar pra
// reordenar aqui é só array local, sem PATCH por etapa (diferente do drag em
// FluxosPanel.tsx, que já opera sobre linhas salvas).

const ICON_OPTIONS = ["⚙", "◆", "✦", "◈", "▦", "▶", "◐", "⬡", "✎", "▧", "◫", "❖"];
const TONE_OPTIONS: { value: "green" | "gold" | "blue" | "purple" | "neutral"; label: string }[] = [
  { value: "green", label: "Verde" },
  { value: "gold", label: "Dourado" },
  { value: "blue", label: "Azul" },
  { value: "purple", label: "Roxo" },
  { value: "neutral", label: "Neutro" },
];

/** Reordena o array local por índice — sem rede, sem rollback, porque nada
 * foi persistido ainda. Mesma ideia de `FluxosPanel.tsx`'s `reorder()`, só
 * que sobre `StepDraft[]` em memória em vez de PATCH de `order_index`. */
function reorderLocal(steps: StepDraft[], draggedIndex: number, beforeIndex: number): StepDraft[] {
  if (draggedIndex === beforeIndex) return steps;
  const dragged = steps[draggedIndex];
  const rest = steps.filter((_, i) => i !== draggedIndex);
  const at = draggedIndex < beforeIndex ? beforeIndex - 1 : beforeIndex;
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

export default function NovoFluxoModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (type: TaskTypeEditorNode) => void;
}) {
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState(ICON_OPTIONS[0]);
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]["value"]>("purple");
  const [showInPerformance, setShowInPerformance] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [stepDraft, setStepDraft] = useState<StepDraft>(EMPTY_STEP);
  const [editingIndex, setEditingIndex] = useState<number | null | "new">(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function saveStepDraft() {
    const trimmed = stepDraft.label.trim();
    if (!trimmed) return;
    const step = { ...stepDraft, label: trimmed };
    if (editingIndex === "new") setSteps((cur) => [...cur, step]);
    else if (typeof editingIndex === "number") setSteps((cur) => cur.map((s, i) => (i === editingIndex ? step : s)));
    setEditingIndex(null);
    setStepDraft(EMPTY_STEP);
  }

  function removeStep(index: number) {
    setSteps((cur) => cur.filter((_, i) => i !== index));
  }

  async function submit() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setError("Dê um nome ao fluxo."); return; }
    if (steps.length === 0) { setError("Adicione pelo menos uma etapa."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/task-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: trimmedLabel,
          behavior: "entrega",
          icon,
          tone,
          show_in_performance: showInPerformance,
          steps: steps.map((s) => ({
            label: s.label,
            lead_days: s.lead_days,
            progress_weight: s.progress_weight,
            default_assignee: s.default_assignee.trim() || null,
            client_visible: s.client_visible,
          })),
        }),
      });
      const payload = (await res.json().catch(() => null)) as (TaskTypeEditorNode & { error?: string }) | null;
      if (!res.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Não foi possível criar o fluxo.");
        setBusy(false);
        return;
      }
      onCreated(payload as TaskTypeEditorNode);
    } catch {
      setError("Não foi possível criar o fluxo — verifique sua conexão.");
      setBusy(false);
    }
  }

  return (
    <div className="kb-modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div className="novofluxo" onClick={(e) => e.stopPropagation()}>
        <div className="attrcfg-head">
          <div>
            <h2>Novo fluxo em cascata</h2>
            <p className="admin-sub">Um tipo Entrega novo, com as próprias etapas — reels, carrossel, o que for.</p>
          </div>
          <button className="kb-modal-close" onClick={onClose} aria-label="Fechar" disabled={busy}>✕</button>
        </div>

        <div className="novofluxo-body">
          <label className="admin-field">
            <span>Nome do fluxo</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Reels" autoFocus />
          </label>

          <div className="admin-field">
            <span>Ícone</span>
            <div className="novofluxo-icons">
              {ICON_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  className={`novofluxo-icon-opt ${icon === opt ? "on" : ""}`}
                  onClick={() => setIcon(opt)}
                  aria-pressed={icon === opt}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-field">
            <span>Cor</span>
            <div className="novofluxo-tones">
              {TONE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  className={`novofluxo-tone-opt tone-${opt.value} ${tone === opt.value ? "on" : ""}`}
                  onClick={() => setTone(opt.value)}
                  aria-pressed={tone === opt.value}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="admin-toggle">
            <input type="checkbox" checked={showInPerformance} onChange={(e) => setShowInPerformance(e.target.checked)} />
            <span className="sw" />
            <span>Aparece na Performance</span>
          </label>

          <div className="novofluxo-steps">
            <span className="admin-sub">Etapas da cascata — arraste para reordenar</span>
            {steps.map((step, index) =>
              editingIndex === index ? (
                <StepEditor
                  key={index}
                  draft={stepDraft}
                  setDraft={setStepDraft}
                  busy={busy}
                  onCancel={() => setEditingIndex(null)}
                  onSave={saveStepDraft}
                />
              ) : (
                <div
                  className={`voc-step ${dragIndex === index ? "dragging" : ""}`}
                  key={index}
                  draggable={editingIndex === null}
                  onDragStart={(e) => { setDragIndex(index); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragIndex;
                    setDragIndex(null);
                    if (from === null) return;
                    setSteps((cur) => reorderLocal(cur, from, index));
                  }}
                >
                  <span className="voc-step-pos" aria-hidden>{index + 1}</span>
                  <div className="voc-step-meta">
                    <div className="voc-type-titlerow">
                      <strong>{step.label}</strong>
                      {step.client_visible ? <span className="set-badge publicada">Cliente vê</span> : null}
                    </div>
                    <span className="admin-sub">
                      peso {step.progress_weight}
                      {step.default_assignee ? ` · ${step.default_assignee}` : ""}
                    </span>
                  </div>
                  <div className="voc-actions">
                    <button
                      className="admin-btn ghost"
                      onClick={() => { setEditingIndex(index); setStepDraft(step); }}
                      disabled={busy || editingIndex !== null}
                    >
                      Editar
                    </button>
                    <button className="admin-btn ghost" onClick={() => removeStep(index)} disabled={busy || editingIndex !== null}>
                      Remover
                    </button>
                  </div>
                </div>
              ),
            )}

            {editingIndex === "new" ? (
              <StepEditor
                draft={stepDraft}
                setDraft={setStepDraft}
                busy={busy}
                onCancel={() => setEditingIndex(null)}
                onSave={saveStepDraft}
              />
            ) : (
              <button
                className="admin-btn ghost voc-add"
                onClick={() => { setEditingIndex("new"); setStepDraft(EMPTY_STEP); }}
                disabled={busy || editingIndex !== null}
              >
                + Etapa
              </button>
            )}
          </div>

          {error ? <p className="admin-error">{error}</p> : null}
        </div>

        <div className="kb-modal-actions">
          <span />
          <div className="kb-modal-actions-right">
            <button className="admin-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="admin-btn primary" onClick={submit} disabled={busy}>
              {busy ? "Criando…" : "Criar fluxo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
