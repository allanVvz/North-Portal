"use client";

import { useState } from "react";
import { contentPlanSteps, type ContentPlanStep, type ContentVolume } from "./contentPlan";

// A pergunta do plano de conteúdo (ATA 14/09): quantos Reels, anúncios e
// carrosséis? Gera as etapas agrupadas pelo volume (ver contentPlan.ts) como
// atividades do plano. Nada é criado aqui: quem chama decide se entram na fila
// do plano ainda não salvo ou nascem direto num plano existente.

const EMPTY: ContentVolume = { reels: 0, anuncios: 0, carrosseis: 0 };

export default function ContentPlanComposer({
  busy,
  onGenerate,
}: {
  busy: boolean;
  onGenerate: (steps: ContentPlanStep[]) => void;
}) {
  const [volume, setVolume] = useState<ContentVolume>(EMPTY);
  const steps = contentPlanSteps(volume);

  const field = (key: keyof ContentVolume, label: string) => (
    <label className="cp-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={60}
        inputMode="numeric"
        value={volume[key]}
        onChange={(event) => setVolume((current) => ({ ...current, [key]: Math.max(0, Math.min(60, Number(event.target.value) || 0)) }))}
      />
    </label>
  );

  return (
    <div className="cp-box">
      <div className="cp-head">
        <p className="cp-title">Plano de conteúdo</p>
        <span className="admin-sub">Quantos conteúdos serão planejados para o cliente?</span>
      </div>
      <div className="cp-fields">
        {field("reels", "Reels")}
        {field("anuncios", "Anúncios")}
        {field("carrosseis", "Carrosséis")}
        <button
          type="button"
          className="admin-btn primary cp-generate"
          disabled={busy || steps.length === 0}
          onClick={() => {
            onGenerate(steps);
            setVolume(EMPTY);
          }}
        >
          + Gerar {steps.length || ""} etapas
        </button>
      </div>
      {steps.length ? (
        <p className="cp-preview">{steps.map((step) => step.title).join(" → ")}</p>
      ) : (
        <p className="cp-preview is-hint">As etapas nascem agrupadas pelo volume: um roteiro e uma gravação para o bloco, edição por formato, aprovação e publicação.</p>
      )}
    </div>
  );
}
