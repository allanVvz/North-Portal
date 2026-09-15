"use client";

import type { BuiltBlueprint } from "@/lib/northai/blueprint";
import type { ContextSourceChip, FormRecipe, StudioDrafts } from "@/lib/northai/drafts";
import ContextSourceChips from "./ContextSourceChips";
import ExecutionResult from "./ExecutionResult";
import GuidedForm from "./GuidedForm";
import PlanPreview from "./PlanPreview";
import { StatusPill } from "./Turns";
import type { RecipeMessage, TypeLite } from "./types";

// A superfície de ferramenta do NorthAi dentro do turno: rascunho (formulário),
// prévia ("o que será criado", o momento principal), criando, resultado.
export default function OperationCard({
  message,
  isOpen,
  busy,
  drafts,
  onDrafts,
  built,
  sources,
  assignees,
  shootTypes,
  deliveryTypes,
  plans,
  routines,
  onDiscard,
  onReview,
  onEdit,
  onConfirm,
  onRestart,
}: {
  message: RecipeMessage;
  isOpen: boolean;
  busy: boolean;
  drafts: StudioDrafts;
  onDrafts: (update: (current: StudioDrafts) => StudioDrafts) => void;
  built: { value: BuiltBlueprint | null; problem: string | null };
  sources: readonly ContextSourceChip[];
  assignees: readonly string[];
  shootTypes: readonly TypeLite[];
  deliveryTypes: readonly TypeLite[];
  plans: readonly { id: string; title: string }[];
  routines: readonly { id: string; title: string }[];
  onDiscard: () => void;
  onReview: () => void;
  onEdit: () => void;
  onConfirm: () => void;
  onRestart: () => void;
}) {
  const reviewing = isOpen && (message.status === "revisar" || message.status === "erro") && built.value;
  return (
    <section className={`nai-op${reviewing ? " is-review" : ""} s-${message.status}`} aria-label={message.title}>
      <header className="nai-op-head">
        <span className="nai-op-kicker">{message.title}</span>
        <StatusPill status={message.status} />
      </header>

      {isOpen && message.status === "rascunho" ? (
        <>
          <ContextSourceChips sources={sources} />
          <GuidedForm
            recipe={message.recipe as FormRecipe}
            drafts={drafts}
            onDrafts={onDrafts}
            assignees={assignees}
            shootTypes={shootTypes}
            deliveryTypes={deliveryTypes}
            plans={plans}
            routines={routines}
          />
          {built.problem ? (
            <div className="nai-missing" role="status">
              <span>Preciso de:</span>
              <span>{built.problem.replace(/\.$/, "")}</span>
            </div>
          ) : null}
          <footer className="nai-op-actions">
            <button type="button" className="admin-btn ghost" onClick={onDiscard}>Cancelar</button>
            <button type="button" className="admin-btn primary" disabled={!built.value} onClick={onReview}>Ver prévia</button>
          </footer>
        </>
      ) : reviewing && built.value ? (
        <>
          <p className="nai-op-title">O que será criado</p>
          <ContextSourceChips sources={sources} />
          <PlanPreview lines={built.value.preview} />
          {message.status === "erro" && message.result?.error ? <p className="admin-error">{message.result.error}</p> : null}
          <footer className="nai-op-actions is-confirm">
            <button type="button" className="nai-link-btn" onClick={onEdit} disabled={busy}>Editar</button>
            <button type="button" className="admin-btn primary nai-confirm" onClick={onConfirm} disabled={busy}>Confirmar e criar</button>
          </footer>
        </>
      ) : message.status === "criando" ? (
        <>
          <PlanPreview lines={message.preview} compact />
          <p className="nai-muted" role="status">Criando…</p>
        </>
      ) : message.status === "criado" || message.status === "erro" ? (
        <>
          {message.preview.length ? <PlanPreview lines={message.preview} compact /> : null}
          <ExecutionResult message={message} onRestart={onRestart} />
        </>
      ) : (
        <p className="nai-muted">{message.note ?? "Cancelado — nada foi criado."}</p>
      )}
    </section>
  );
}
